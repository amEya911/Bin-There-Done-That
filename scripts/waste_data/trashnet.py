from collections import defaultdict
import io
import json
from pathlib import Path
import random
import urllib.request
import zipfile
from PIL import Image, ImageOps
from .core import CONFIG, image_fingerprint, now, read_jsonl, sha, write_json, write_jsonl


def seed(home, limit=2444):
    home = Path(home)
    url = "https://raw.githubusercontent.com/garythung/trashnet/master/data/dataset-resized.zip"
    archive_file = home / "sources/trashnet-resized.zip"
    if not archive_file.exists():
        with urllib.request.urlopen(url, timeout=60) as response: archive_file.write_bytes(response.read())
    existing = {r["id"]: r for r in read_jsonl(home / "manifest.jsonl")}
    archive_hash = sha(archive_file)
    hashes = {r["image"]["pixelSha256"] for r in existing.values()}
    failures, duplicates, added = [], [], 0
    with zipfile.ZipFile(archive_file) as archive:
        pools = defaultdict(list)
        for member in archive.namelist():
            if member.startswith("dataset-resized/") and member.lower().endswith(".jpg") and "__MACOSX" not in member:
                pools[Path(member).parent.name].append(member)
        rng = random.Random(CONFIG["seed"])
        for pool in pools.values(): pool.sort(); rng.shuffle(pool)
        # Round-robin preserves rare trash examples rather than filling only the largest class.
        ordered = []
        while any(pools.values()):
            for label in sorted(pools):
                if pools[label]: ordered.append(pools[label].pop())
        for member in ordered:
            key = "trashnet-" + Path(member).stem
            if key in existing:
                added += 1
                if added >= limit: break
                continue
            try:
                content = archive.read(member)
                file = home / "images" / (key + ".jpg")
                with Image.open(io.BytesIO(content)) as image: ImageOps.exif_transpose(image).convert("RGB").save(file, quality=95)
                fingerprint = image_fingerprint(file)
                if fingerprint["pixelSha256"] in hashes:
                    file.unlink(); duplicates.append(member); continue
                label = Path(member).parent.name
                record = {"schemaVersion": "1.0.0", "id": key, "task": "objects", "createdAt": now(), "image": {"path": str(file.relative_to(home)), **fingerprint}, "source": {"dataset": "TrashNet", "url": url, "page": "https://huggingface.co/datasets/garythung/trashnet", "archiveMember": member, "archiveSha256": archive_hash, "sourceImageLabel": label, "annotationType": "image_classification_only_no_boxes", "license": "MIT", "licenseUrl": "https://github.com/garythung/trashnet/blob/master/LICENSE", "licenseBasis": "Dataset creator's Hugging Face repository declares MIT; source repository license retained", "attribution": "Gary Thung and Mindy Yang, TrashNet (2016/2017), https://github.com/garythung/trashnet"}, "groups": {"session": "trashnet-source-session-unverified", "entity": "trashnet-item-group-unverified", "site": "trashnet-white-posterboard-source"}, "domain": "physical_scene", "domainReviewed": False, "qualityHold": [], "boxes": [], "review": {"state": "pending", "complete": False, "rightsChecked": False, "groupingChecked": False, "unresolvedTargets": True, "confirmedNegative": False, "reviewer": None, "reviewedAt": None}, "reservedEvaluation": False}
                existing[key] = record; hashes.add(fingerprint["pixelSha256"]); added += 1
                if added % 250 == 0: print(f"TrashNet unique photos prepared: {added}/{limit}", flush=True)
                if added >= limit: break
            except Exception as error: failures.append({"member": member, "error": str(error)})
    write_jsonl(home / "manifest.jsonl", sorted(existing.values(), key=lambda r: r["id"]))
    write_json(home / "sources/trashnet-status.json", {"requested": limit, "prepared": added, "exactDuplicatesSkipped": duplicates, "failures": failures, "annotationType": "classification_only_needs_boxes"})
    print("TrashNet prepared:", added, "exact duplicates skipped:", len(duplicates), "failures:", len(failures), flush=True)
