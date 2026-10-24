import json
import math
from pathlib import Path
import shutil
from .core import CLASSES, CONDITIONS, ROOT, CONFIG, issues, now, read_jsonl, safe_file, sha, split_records, write_json, write_jsonl


def link_or_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def export_dataset(home, output):
    home, output = Path(home), Path(output)
    records = read_jsonl(home / "manifest.jsonl")
    accepted = [r for r in records if r["review"]["state"] == "accepted"]
    if not accepted: raise ValueError("No accepted labels yet. Review the annotation queue before exporting training data.")
    ledger_file = home / "splits.json"
    if not ledger_file.exists(): raise ValueError("Freeze grouped train/val/test splits first")
    ledger = json.loads(ledger_file.read_text())
    split_records(records, ledger)  # Recheck transitive/duplicate leakage after annotation edits.
    errors = {r["id"]: e for r in accepted if (e := issues(r, home))}
    if errors: raise ValueError("Accepted records failed validation: " + json.dumps(errors))
    if any(ledger.get(r["id"]) not in ["train", "val", "test"] for r in accepted): raise ValueError("Accepted image has no training split")
    if output.exists(): raise ValueError("Export path already exists. Choose a new version; never overwrite a frozen export.")
    output.mkdir(parents=True)
    try:
        coco = {s: {"info": {"description": CONFIG["datasetId"]}, "images": [], "annotations": [], "categories": [{"id": i + 1, "name": name} for name, i in CLASSES.items()]} for s in ["train", "val", "test"]}
        aid = 1
        for image_id, r in enumerate(accepted, 1):
            split = ledger[r["id"]]; image = r["image"]; width, height = image["width"], image["height"]
            file_name = r["id"] + Path(image["path"]).suffix
            for model in ["yolo", "coco"]:
                folder = "valid" if model == "coco" and split == "val" else split
                link_or_copy(safe_file(home, image["path"]), output / model / folder / "images" / file_name)
            labels = []
            coco[split]["images"].append({"id": image_id, "file_name": "images/" + file_name, "width": width, "height": height})
            for b in r["boxes"]:
                x, y, w, h = b["bbox"]; canonical = CLASSES[b["label"]]
                labels.append(f"{canonical} {(x + w / 2) / width:.8f} {(y + h / 2) / height:.8f} {w / width:.8f} {h / height:.8f}")
                coco[split]["annotations"].append({"id": aid, "image_id": image_id, "category_id": canonical + 1, "bbox": [x, y, w, h], "area": w * h, "iscrowd": 0}); aid += 1
            label_path = output / "yolo" / split / "labels" / (r["id"] + ".txt")
            label_path.parent.mkdir(parents=True, exist_ok=True); label_path.write_text("\n".join(labels) + ("\n" if labels else ""))
        # JSON is valid YAML too, avoids emitter-dependent type/ID conversions.
        write_json(output / "yolo/data.yaml", {"path": str((output / "yolo").resolve()), "train": "train/images", "val": "val/images", "test": "test/images", "names": list(CLASSES)})
        for split, data in coco.items():
            folder = "valid" if split == "val" else split
            (output / "coco" / folder / "images").mkdir(parents=True, exist_ok=True)
            write_json(output / "coco" / folder / "_annotations.coco.json", data)
        condition_records = read_jsonl(home / "conditions.jsonl")
        by_id = {r["id"]: r for r in records}
        accepted_conditions = []
        for c in condition_records:
            if c.get("review", {}).get("state") != "accepted": continue
            parent = by_id.get(c["parentId"])
            if not parent or parent["review"]["state"] != "accepted": raise ValueError("Condition parent is not accepted")
            box = next((b for b in parent["boxes"] if b["id"] == c["binBoxId"] and b["label"] == "waste_bin"), None)
            if not box or c.get("parentImageSha256") != parent["image"]["sha256"] or not all(math.isclose(a, b, abs_tol=.01) for a, b in zip(box["bbox"], c.get("binBoxAtCrop", []))) or len(c.get("binBoxAtCrop", [])) != 4:
                raise ValueError("Bin crop no longer matches its parent annotation; regenerate and review it")
            if c.get("condition") not in CONDITIONS: raise ValueError("Unverifiable/null condition cannot be a fourth training class")
            if not c["review"].get("reviewer") or not c["review"].get("openingVisible") or not c["review"].get("spillageOriginChecked"):
                raise ValueError("Condition inspection checks missing")
            if sha(safe_file(home, c["image"]["path"])) != c["image"]["sha256"]: raise ValueError("Condition crop changed")
            label = c["condition"]; split = ledger[parent["id"]]
            folder = f"{CONDITIONS[label]}_{label}"
            link_or_copy(safe_file(home, c["image"]["path"]), output / "conditions" / split / folder / (c["id"] + ".jpg"))
            accepted_conditions.append(c)
        write_jsonl(output / "metadata/objects.jsonl", accepted)
        write_jsonl(output / "metadata/conditions.jsonl", accepted_conditions)
        write_json(output / "metadata/splits.json", {r["id"]: ledger[r["id"]] for r in accepted})
        write_json(output / "metadata/class-id-map.json", {"yoloCanonicalZeroBased": CLASSES, "cocoOneBased": {k: v + 1 for k, v in CLASSES.items()}, "conditionFolderToCanonical": {f"{v}_{k}": v for k, v in CONDITIONS.items()}})
        observed = sorted({b["label"] for r in accepted for b in r["boxes"]}, key=CLASSES.get)
        write_json(output / "manifest.json", {"datasetId": CONFIG["datasetId"], "createdAt": now(), "taxonomySha256": sha(ROOT / CONFIG["taxonomy"]), "sourceManifestSha256": sha(home / "manifest.jsonl"), "objectImages": len(accepted), "conditionCrops": len(accepted_conditions), "observedObjectClasses": observed, "missingObjectClasses": [n for n in CLASSES if n not in observed], "runtimeEnabled": False, "modelTrained": False})
    except Exception:
        shutil.rmtree(output); raise
    print("Exported reviewed data:", output)
