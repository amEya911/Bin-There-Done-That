from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import random
import time
import urllib.request
import zipfile
import threading
from PIL import Image, ImageOps
from .core import ROOT, CONFIG, REVIEW_SENTINEL, image_fingerprint, now, read_jsonl, sha, write_json, write_jsonl
from .archive import RangeReader, RequestPacer


def seed(home, limit=120):
    home = Path(home); sources = home / "sources"
    mapping = json.loads((ROOT / "training/taco-label-map.json").read_text())
    revision = mapping["annotationRevision"]
    url = f"https://raw.githubusercontent.com/pedropro/TACO/{revision}/data/annotations.json"
    annotation = sources / "taco-annotations.json"
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read()
    # Preserve the exact source snapshot used to generate the proposals.
    annotation.write_bytes(raw)
    data = json.loads(raw)
    metadata_file = sources / "zenodo-release.json"
    if not metadata_file.exists():
        with urllib.request.urlopen("https://zenodo.org/api/records/3587843", timeout=30) as response:
            metadata_file.write_bytes(response.read())
    release = json.loads(metadata_file.read_text())
    if release["metadata"].get("license", {}).get("id") != "cc-by-4.0":
        raise ValueError("Published release license changed; review source before proceeding")
    names = {c["id"]: c["name"] for c in data["categories"]}
    if set(names.values()) != set(mapping["mapping"]):
        raise ValueError("Source categories changed; update the explicit mapping")
    images = {i["id"]: i for i in data["images"]}
    annotations = defaultdict(list); by_target = defaultdict(set)
    for a in data["annotations"]:
        annotations[a["image_id"]].append(a)
        target = mapping["mapping"][names[a["category_id"]]]
        if target: by_target[target].add(a["image_id"])
    rng = random.Random(CONFIG["seed"])
    selected = set()
    # Rare targets first; bounded initial review queue, not a complete training set.
    for label in sorted(by_target, key=lambda x: (len(by_target[x]), x)):
        pool = sorted(by_target[label]); rng.shuffle(pool)
        for identity in pool[:6]:
            if len(selected) < limit: selected.add(identity)
    pool = sorted(set(images) - selected); rng.shuffle(pool)
    selected.update(pool[:max(0, limit - len(selected))])
    existing = {r["id"]: r for r in read_jsonl(home / "manifest.jsonl")}
    archive_url = "https://zenodo.org/records/3587843/files/TACO.zip?download=1"
    pacer = RequestPacer(); worker = threading.local(); archives = []; archive_lock = threading.Lock()

    def source_archive():
        if not hasattr(worker, "archive"):
            reader = RangeReader(archive_url, release["files"][0]["size"], pacer=pacer)
            archive = zipfile.ZipFile(reader)
            reader.prefetch = {entry.header_offset: entry.compress_size + len(entry.filename.encode()) + 4096 for entry in archive.infolist() if entry.filename.endswith(".jpg")}
            worker.archive = archive
            with archive_lock: archives.append((archive, reader))
        return worker.archive

    def fetch(identity):
        image = images[identity]; key = f"taco-{identity:05d}"
        if key in existing: return existing[key]
        original = home / "source-images" / f"{key}.jpg"
        image_url = image["flickr_url"]
        if not original.exists():
            # The mirror returned403 for part of the source. Use the public
            # archive linked by the dataset authors, without retrying that mirror.
            content = source_archive().read("TACO/data/" + image["file_name"])
            part = original.with_suffix(".part"); part.write_bytes(content)
            with Image.open(part) as check: check.verify()
            part.replace(original)
        normalized = home / "images" / f"{key}.jpg"
        with Image.open(original) as decoded:
            display = ImageOps.exif_transpose(decoded).convert("RGB")
            display.save(normalized, quality=95)
        fingerprint = image_fingerprint(normalized)
        mismatch = [fingerprint["width"], fingerprint["height"]] != [image["width"], image["height"]]
        boxes = []
        for a in annotations[identity]:
            source_label = names[a["category_id"]]
            label = mapping["mapping"][source_label] or REVIEW_SENTINEL
            x, y, w, h = a["bbox"]
            # Keep source extents; clipping never expands hidden or thin objects.
            left, top = max(0, x), max(0, y)
            right, bottom = min(image["width"], x + w), min(image["height"], y + h)
            if right <= left or bottom <= top: raise ValueError("Source contains an invalid box")
            boxes.append({"id": f"taco-a{a['id']}", "label": label, "bbox": [left, top, right - left, bottom - top], "sourceCategory": source_label, "sourceAnnotationId": a["id"], "material": "unknown", "materialBasis": "unknown", "materialReference": None, "visibility": "clear", "visibilityReviewed": False})
        batch = image["file_name"].split("/")[0]
        return {"schemaVersion": "1.0.0", "id": key, "task": "objects", "createdAt": now(), "image": {"path": str(normalized.relative_to(home)), **fingerprint, "originalSha256": sha(original)}, "source": {"dataset": "TACO", "url": image_url, "page": mapping["source"], "sourceImageId": identity, "sourceFile": image["file_name"], "annotationUrl": url, "annotationSha256": sha(annotation), "license": "CC-BY-4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/", "licenseBasis": "Published TACO v1.0 dataset release declaration; original image notes retained for review", "releaseMetadataSha256": sha(metadata_file), "originalLicenseNote": image.get("license"), "attribution": "Pedro F. Proença and Pedro Simões; TACO: Trash Annotations in Context for Litter Detection (2020); image contributors as recorded by source"}, "groups": {"session": f"taco-source-{batch}", "entity": f"taco-image-{identity}", "site": f"taco-source-{batch}-physical-site-unverified"}, "domain": "physical_scene", "domainReviewed": False, "qualityHold": ["source_dimensions_mismatch"] if mismatch else [], "boxes": boxes, "review": {"state": "pending", "complete": False, "rightsChecked": False, "groupingChecked": False, "unresolvedTargets": True, "confirmedNegative": False, "reviewer": None, "reviewedAt": None}, "reservedEvaluation": False}

    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch, identity): identity for identity in sorted(selected)}
        for index, future in enumerate(as_completed(futures), 1):
            try:
                row = future.result(); existing[row["id"]] = row
            except Exception as error:
                failures.append({"sourceImageId": futures[future], "error": str(error)})
            if index % 20 == 0:
                print(f"Public source images prepared: {index}/{len(selected)}", flush=True)
                write_jsonl(home / "manifest.jsonl", sorted(existing.values(), key=lambda r: r["id"]))
    write_jsonl(home / "manifest.jsonl", sorted(existing.values(), key=lambda r: r["id"]))
    for archive, reader in archives:
        archive.close(); reader.close()
    write_json(home / "sources/taco-download-status.json", {"requested": len(selected), "failed": failures, "annotationRevision": revision, "annotationSha256": sha(annotation)})
    print(f"Starter queue: {len(existing)} images; {len(failures)} download failures. All labels await review.", flush=True)
