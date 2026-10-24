from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import json
from pathlib import Path
import random
import urllib.request
from PIL import Image, ImageOps
from .core import CONFIG, image_fingerprint, now, read_jsonl, sha, write_json, write_jsonl


def seed(home):
    home = Path(home); sources = home / "sources"
    files = {
        "openimages-validation-boxes.csv": "https://storage.googleapis.com/openimages/v5/validation-annotations-bbox.csv",
        "openimages-validation-images.csv": "https://storage.googleapis.com/openimages/2018_04/validation/validation-images-with-rotation.csv",
        "openimages-classes.csv": "https://storage.googleapis.com/openimages/v5/class-descriptions-boxable.csv",
    }
    for filename, url in files.items():
        if not (sources / filename).exists():
            with urllib.request.urlopen(url, timeout=60) as response: (sources / filename).write_bytes(response.read())
    names = dict(csv.reader((sources / "openimages-classes.csv").open()))
    target = {"Waste container": "waste_bin", "Mug": "mug", "Light bulb": "light_bulb", "Drinking straw": "straw", "Paper towel": "paper_towel", "Scarf": "textile_item", "Mobile phone": "small_electronic"}
    desired = {"Waste container": 20, "Fire hydrant": 8, "Mug": 8, "Light bulb": 8, "Paper towel": 6, "Scarf": 6, "Mobile phone": 6}
    rows = defaultdict(list); pools = defaultdict(set)
    for row in csv.DictReader((sources / "openimages-validation-boxes.csv").open()):
        name = names[row["LabelName"]]
        if name in [*target, "Fire hydrant"]:
            rows[row["ImageID"]].append(row)
            if name in desired and row["IsGroupOf"] == "0": pools[name].add(row["ImageID"])
    metadata = {r["ImageID"]: r for r in csv.DictReader((sources / "openimages-validation-images.csv").open())}
    rng = random.Random(CONFIG["seed"]); selected = set()
    for name, limit in desired.items():
        pool = sorted(pools[name]); rng.shuffle(pool)
        allowed = [i for i in pool if metadata[i]["License"] in ["https://creativecommons.org/licenses/by/2.0/", "https://creativecommons.org/licenses/by/4.0/"]]
        selected.update(allowed[:limit])
    existing = {r["id"]: r for r in read_jsonl(home / "manifest.jsonl")}

    def fetch(identity):
        key = "oi-" + identity
        if key in existing: return existing[key]
        meta = metadata[identity]; url = f"https://open-images-dataset.s3.amazonaws.com/validation/{identity}.jpg"
        original = home / "source-images" / f"{key}.jpg"
        if not original.exists():
            with urllib.request.urlopen(url, timeout=30) as response: content = response.read(20 * 1024 * 1024)
            original.write_bytes(content)
        file = home / "images" / f"{key}.jpg"
        with Image.open(original) as image: ImageOps.exif_transpose(image).convert("RGB").save(file, quality=95)
        fingerprint = image_fingerprint(file); w, h = fingerprint["width"], fingerprint["height"]
        boxes = []
        for index, b in enumerate(rows[identity]):
            name = names[b["LabelName"]]
            if name not in target: continue  # Fire hydrants are a documented non-bin negative, not a new model class.
            x, y, right, bottom = [float(b[k]) for k in ["XMin", "YMin", "XMax", "YMax"]]
            boxes.append({"id": f"oi-{identity}-{index}", "label": target[name], "bbox": [x * w, y * h, (right - x) * w, (bottom - y) * h], "sourceCategory": name, "sourceGroupOf": b["IsGroupOf"] == "1", "material": "unknown", "materialBasis": "unknown", "materialReference": None, "visibility": "partly_occluded" if b["IsOccluded"] == "1" else "clear", "visibilityReviewed": False})
        return {"schemaVersion": "1.0.0", "id": key, "task": "objects", "createdAt": now(), "image": {"path": str(file.relative_to(home)), **fingerprint, "originalSha256": sha(original)}, "source": {"dataset": "Open Images V7 (v5 validation box annotations)", "url": url, "page": meta["OriginalLandingURL"], "originalUrl": meta["OriginalURL"], "sourceImageId": identity, "annotationUrl": files["openimages-validation-boxes.csv"], "annotationSha256": sha(sources / "openimages-validation-boxes.csv"), "license": "CC-BY-2.0" if "/2.0/" in meta["License"] else "CC-BY-4.0", "licenseUrl": meta["License"], "licenseBasis": "Open Images per-image metadata declaration; verify linked original during rights review", "originalLicenseNote": meta["License"], "attribution": meta["Author"] + " — " + meta["Title"], "authorUrl": meta["AuthorProfileURL"], "hardNegative": any(names[x["LabelName"]] == "Fire hydrant" for x in rows[identity])}, "groups": {"session": "oi-author:" + meta["AuthorProfileURL"], "entity": "oi-photo:" + meta["OriginalLandingURL"], "site": "oi-author-site-unverified:" + meta["AuthorProfileURL"]}, "domain": "physical_scene", "domainReviewed": False, "qualityHold": ["source_group_requires_instance_review"] if any(b["sourceGroupOf"] for b in boxes) else [], "boxes": boxes, "review": {"state": "pending", "complete": False, "rightsChecked": False, "groupingChecked": False, "unresolvedTargets": True, "confirmedNegative": False, "reviewer": None, "reviewedAt": None}, "reservedEvaluation": False}

    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(fetch, i): i for i in sorted(selected)}
        for future in as_completed(pending):
            try:
                record = future.result(); existing[record["id"]] = record
            except Exception as e: failures.append({"id": pending[future], "error": str(e)})
    write_jsonl(home / "manifest.jsonl", sorted(existing.values(), key=lambda r: r["id"]))
    write_json(home / "sources/openimages-download-status.json", {"requested": len(selected), "failures": failures})
    print("Open Images candidates:", len(selected) - len(failures), "failures:", len(failures))


def make_condition_crops(home):
    home = Path(home); records = read_jsonl(home / "manifest.jsonl")
    existing = {c["id"]: c for c in read_jsonl(home / "conditions.jsonl")}
    for record in records:
        w, h = record["image"]["width"], record["image"]["height"]
        for b in record["boxes"]:
            if b["label"] != "waste_bin": continue
            identity = record["id"] + "-" + b["id"]
            if identity in existing: continue
            x, y, bw, bh = b["bbox"]; padding = .15
            rect = [max(0, int(x - bw * padding)), max(0, int(y - bh * padding)), min(w, int(x + bw * (1 + padding) + 1)), min(h, int(y + bh * (1 + padding) + 1))]
            file = home / "conditions" / (identity + ".jpg")
            with Image.open(home / record["image"]["path"]) as image: image.crop(rect).save(file, quality=95)
            existing[identity] = {"id": identity, "parentId": record["id"], "parentImageSha256": record["image"]["sha256"], "binBoxId": b["id"], "binBoxAtCrop": b["bbox"], "image": {"path": str(file.relative_to(home)), **image_fingerprint(file)}, "sourceCropXYXY": rect, "source": record["source"], "groups": record["groups"], "condition": None, "qualityFlags": [], "review": {"state": "pending", "reviewer": None, "openingVisible": False, "spillageOriginChecked": False, "notes": "Bin candidate only. Verify that this is one supported bin and inspect the opening; never infer condition from the source label."}}
    write_jsonl(home / "conditions.jsonl", sorted(existing.values(), key=lambda c: c["id"]))
    print("Unclassified bin-crop review tasks:", len(existing))
