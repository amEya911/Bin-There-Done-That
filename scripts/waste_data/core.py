from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "training/dataset-v1.json").read_text())
SPEC = json.loads((ROOT / CONFIG["taxonomy"]).read_text())
CLASSES = {c["name"]: c["id"] for c in SPEC["objectDetection"]["classes"]}
CONDITIONS = {c["name"]: c["id"] for c in SPEC["binCondition"]["classes"]}
REVIEW_SENTINEL = "REVIEW_UNMAPPED"


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()] if Path(path).exists() else []


def write_json(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n"); temp.replace(path)


def write_jsonl(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text("".join(json.dumps(row) + "\n" for row in data)); temp.replace(path)


def initialize(home):
    home = Path(home)
    for folder in ["images", "source-images", "sources", "annotations", "conditions", "imports", "inbox", "exports", "reviews", "label-studio"]:
        (home / folder).mkdir(parents=True, exist_ok=True)
    for name in ["manifest.jsonl", "conditions.jsonl"]:
        (home / name).touch(exist_ok=True)
    snapshot = {"specVersion": SPEC["specVersion"], "taxonomySha256": sha(ROOT / CONFIG["taxonomy"]), "objects": CLASSES, "conditions": CONDITIONS}
    file = home / "taxonomy.json"
    if file.exists() and json.loads(file.read_text()) != snapshot:
        raise ValueError("Dataset taxonomy differs. Create a new dataset version; do not silently reorder labels.")
    write_json(file, snapshot)
    return home


def safe_file(home, relative):
    path = (Path(home) / relative).resolve()
    if not path.is_relative_to(Path(home).resolve()):
        raise ValueError("Dataset path escapes its root")
    return path


def image_fingerprint(path):
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        width, height = rgb.size
        pixel_sha = hashlib.sha256(f"{width}x{height}:".encode() + rgb.tobytes()).hexdigest()
        small = rgb.convert("L").resize((17, 16), Image.Resampling.LANCZOS)
        values = list(small.get_flattened_data())
        bits = 0
        for y in range(16):
            for x in range(16):
                bits = (bits << 1) | int(values[y * 17 + x] > values[y * 17 + x + 1])
        return {"width": width, "height": height, "sha256": sha(path), "pixelSha256": pixel_sha, "dhash256": f"{bits:064x}"}


def rect_valid(box, width, height):
    return isinstance(box, list) and len(box) == 4 and all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in box) and box[0] >= 0 and box[1] >= 0 and box[2] > 0 and box[3] > 0 and box[0] + box[2] <= width + .01 and box[1] + box[3] <= height + .01


def issues(record, home, verify_bytes=True):
    errors = []
    try:
        image = record["image"]; path = safe_file(home, image["path"])
        if not path.is_file(): errors.append("image_missing")
        elif verify_bytes and sha(path) != image["sha256"]: errors.append("image_hash_changed")
        width, height = image["width"], image["height"]
        if width <= 0 or height <= 0: errors.append("invalid_dimensions")
    except (KeyError, TypeError, ValueError):
        return ["invalid_image_record"]
    source = record.get("source", {})
    if not source.get("url") or not source.get("attribution"): errors.append("source_provenance_missing")
    if not source.get("license") or not source.get("licenseUrl"): errors.append("license_missing")
    groups = record.get("groups", {})
    if not all(groups.get(k) for k in ["session", "entity", "site"]): errors.append("group_metadata_missing")
    if record.get("domain") not in SPEC["annotationAttributes"]["domain"]: errors.append("invalid_domain")
    review = record.get("review", {})
    state = review.get("state")
    if state not in ["pending", "accepted", "needs_review", "excluded"]: errors.append("invalid_review_state")
    boxes = record.get("boxes", [])
    ids = [b.get("id") for b in boxes]
    if len(ids) != len(set(ids)) or any(not i for i in ids): errors.append("duplicate_or_missing_box_id")
    for b in boxes:
        if b.get("label") not in CLASSES and b.get("label") != REVIEW_SENTINEL: errors.append("invalid_class")
        if not rect_valid(b.get("bbox"), width, height): errors.append("invalid_box")
        material = b.get("material", "unknown")
        if material not in SPEC["annotationAttributes"]["material"]: errors.append("invalid_material")
        if material != "unknown" and (b.get("materialBasis") not in ["verified_product_information", "legible_material_marking"] or not b.get("materialReference")):
            errors.append("material_without_evidence")
    if state == "accepted":
        if not all(review.get(k) for k in ["reviewer", "reviewedAt", "complete", "rightsChecked", "groupingChecked"]): errors.append("acceptance_checks_missing")
        if review.get("unresolvedTargets"): errors.append("unresolved_targets")
        if any(b.get("label") == REVIEW_SENTINEL for b in boxes): errors.append("unresolved_source_region")
        if any(not b.get("visibilityReviewed") or b.get("visibility") not in SPEC["annotationAttributes"]["visibility"] for b in boxes): errors.append("visibility_not_reviewed")
        if not record.get("domainReviewed"): errors.append("domain_not_reviewed")
        if not boxes and not review.get("confirmedNegative"): errors.append("unconfirmed_negative")
        if record.get("qualityHold"): errors.append("quality_hold")
        if record.get("reservedEvaluation"): errors.append("reserved_evaluation_not_training")
        reservations = Path(home) / "evaluation-reservations.json"
        if reservations.exists():
            for reserved in json.loads(reservations.read_text()):
                if image["sha256"] == reserved["sha256"] or image["pixelSha256"] == reserved["pixelSha256"] or image.get("originalSha256") == reserved["sha256"]:
                    errors.append("reserved_evaluation_not_training"); break
                if (int(image["dhash256"], 16) ^ int(reserved["dhash256"], 16)).bit_count() <= CONFIG["nearDuplicateHammingDistance"]:
                    errors.append("possible_reserved_evaluation_duplicate"); break
    return sorted(set(errors))


def reserve_evaluation(home):
    destination = Path(home) / "evaluation-reservations.json"
    if destination.exists(): return
    files = list((ROOT / ".data/vision-accuracy/images").glob("*.jpg"))
    files += list((ROOT / "tests/fixtures/vision").glob("*.jpg"))
    files += list((ROOT / "public/images").glob("*.jpg"))
    files += [p for p in (ROOT / ".data/model-export").glob("*.jpg")]
    write_json(destination, [{"source": str(p.relative_to(ROOT)), **image_fingerprint(p)} for p in files])


def make_groups(records, max_distance=6):
    parent = {r["id"]: r["id"] for r in records}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def join(a, b):
        ra, rb = find(a), find(b)
        if ra != rb: parent[max(ra, rb)] = min(ra, rb)
    tokens = {}
    for r in records:
        keys = [f"{k}:{v}" for k, v in r["groups"].items() if v]
        keys += ["bytes:" + r["image"]["sha256"], "pixels:" + r["image"]["pixelSha256"]]
        for key in keys:
            if key in tokens: join(r["id"], tokens[key])
            tokens[key] = r["id"]
    for i, a in enumerate(records):
        for b in records[:i]:
            if (int(a["image"]["dhash256"], 16) ^ int(b["image"]["dhash256"], 16)).bit_count() <= max_distance:
                join(a["id"], b["id"])
    groups = defaultdict(list)
    for r in records: groups[find(r["id"])].append(r["id"])
    return list(groups.values())


def split_records(records, ledger=None):
    ledger = dict(ledger or {})
    for group in make_groups(records, CONFIG["nearDuplicateHammingDistance"]):
        fixed = {ledger[i] for i in group if i in ledger}
        if len(fixed) > 1: raise ValueError("A related/duplicate group crosses frozen splits. Resolve the leakage explicitly.")
        if fixed: selected = next(iter(fixed))
        else:
            token = f"{CONFIG['seed']}:{min(group)}".encode()
            point = int(hashlib.sha256(token).hexdigest()[:12], 16) / 16 ** 12
            ratios = CONFIG["splitRatios"]
            selected = "train" if point < ratios["train"] else "val" if point < ratios["train"] + ratios["val"] else "test"
        for identity in group: ledger[identity] = selected
    return ledger


def coverage(records, conditions, ledger):
    rows = []
    for label, canonical_id in CLASSES.items():
        proposed = [r for r in records if any(b["label"] == label for b in r.get("boxes", []))]
        accepted = [r for r in proposed if r["review"]["state"] == "accepted"]
        row = {"id": canonical_id, "label": label, "proposedImages": len(proposed), "acceptedImages": len(accepted)}
        row.update({split: sum(ledger.get(r["id"]) == split for r in accepted) for split in ["train", "val", "test"]})
        rows.append(row)
    return {"generatedAt": now(), "objectImages": len(records), "reviewStates": dict(Counter(r["review"]["state"] for r in records)), "proposedSplits": dict(Counter(ledger.get(r["id"], "unassigned") for r in records)), "relatedGroups": len(make_groups(records)), "classes": rows, "conditionCrops": len(conditions), "acceptedConditions": dict(Counter(c.get("condition") for c in conditions if c.get("review", {}).get("state") == "accepted")), "trainingReady": False, "runtimeActivated": False}
