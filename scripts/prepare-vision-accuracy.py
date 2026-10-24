"""Prepare a fixed random COCO val2017 subset; no training or cloud writes.

Fetch only the validation annotation member using HTTP ranges, not the full ZIP.
The sample is selected before predictions, with an explicit reproducible seed.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import json
from pathlib import Path
import random
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / ".data/vision-accuracy"
IMAGES = DEST / "images"
IMAGES.mkdir(parents=True, exist_ok=True)
URL = "https://s3.amazonaws.com/images.cocodataset.org/annotations/annotations_trainval2017.zip"
SEED = 20261024


class RemoteZip(io.RawIOBase):
    def __init__(self):
        self.pos = 0
        with urllib.request.urlopen(urllib.request.Request(URL, method="HEAD"), timeout=30) as response:
            self.size = int(response.headers["Content-Length"])

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, size=-1):
        size = self.size - self.pos if size < 0 else min(size, self.size - self.pos)
        if size <= 0:
            return b""
        request = urllib.request.Request(URL, headers={"Range": f"bytes={self.pos}-{self.pos + size - 1}"})
        with urllib.request.urlopen(request, timeout=45) as response:
            if response.status != 206:
                raise RuntimeError("Server did not honor the range request; refusing full ZIP download")
            data = response.read()
        self.pos += len(data)
        return data


annotation = DEST / "instances_val2017.json"
if not annotation.exists():
    with zipfile.ZipFile(RemoteZip()) as archive:
        member = archive.getinfo("annotations/instances_val2017.json")
        print("Validation annotation compressed bytes:", member.compress_size, flush=True)
        annotation.write_bytes(archive.read(member))

data = json.loads(annotation.read_text())
categories = {cat["name"]: cat["id"] for cat in data["categories"]}
sets = {label: set() for label in ("bottle", "cup")}
for ann in data["annotations"]:
    if not ann.get("iscrowd"):
        for label, values in sets.items():
            if ann["category_id"] == categories[label]:
                values.add(ann["image_id"])
rng = random.Random(SEED)
bottles = rng.sample(sorted(sets["bottle"]), 40)
cups = rng.sample(sorted(sets["cup"] - set(bottles)), 40)
all_images = {image["id"]: image for image in data["images"]}
negative = rng.sample(sorted(set(all_images) - sets["bottle"] - sets["cup"]), 20)
ids = bottles + cups + negative
rng.shuffle(ids)
sample = {"seed": SEED, "selection": "40 random bottle-positive images,40 additional cup-positive images,20 images with neither target; sorted source pools, no selection by model output", "source": URL, "annotationSha256": hashlib.sha256(annotation.read_bytes()).hexdigest(), "categoryIds": {name: categories[name] for name in sets}, "imageIds": ids, "groups": {"bottlePositive": bottles, "cupPositive": cups, "targetNegative": negative}, "images": [all_images[i] for i in ids]}
(DEST / "sample.json").write_text(json.dumps(sample, indent=2) + "\n")
subset = {**data, "images": sample["images"], "annotations": [a for a in data["annotations"] if a["image_id"] in set(ids)]}
(DEST / "subset-annotations.json").write_text(json.dumps(subset))


def download(image):
    file = IMAGES / image["file_name"]
    if file.exists():
        return file
    url = "https://s3.amazonaws.com/images.cocodataset.org/val2017/" + image["file_name"]
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                content = response.read()
            if not content.startswith(b"\xff\xd8"):
                raise RuntimeError("Image response is not a JPEG")
            file.write_bytes(content)
            return file
        except Exception:
            if attempt == 2:
                raise
            time.sleep(.5)


with ThreadPoolExecutor(max_workers=6) as pool:
    futures = [pool.submit(download, image) for image in sample["images"]]
    for i, future in enumerate(as_completed(futures), 1):
        future.result()
        if i % 20 == 0:
            print(f"Images ready: {i}/100", flush=True)
print("Prepared 100 images, target category IDs", sample["categoryIds"], flush=True)
