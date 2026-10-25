"""Generate local Florence-2 annotation proposals; never accept labels or train by itself."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from PIL import Image, ImageDraw, ImageFont, ImageOps
from waste_data.core import ROOT, CONFIG, CLASSES, read_jsonl, write_json, write_jsonl, now, sha

MODEL = "florence-community/Florence-2-base"
HOME = ROOT / CONFIG["dataRoot"]
PROPOSALS = HOME / "auto-labels/florence-proposals.jsonl"

ALIASES = {
    "bottle": "bottle", "plastic bottle": "bottle", "glass bottle": "bottle", "water bottle": "bottle", "wine bottle": "bottle", "beer bottle": "bottle",
    "bottle cap": "bottle_cap", "cap": "bottle_cap", "jar": "jar", "glass jar": "jar",
    "soda can": "beverage_can", "beer can": "beverage_can", "beverage can": "beverage_can", "tin can": "food_tin",
    "paper": "paper_sheet", "newspaper": "paper_sheet", "sheet of paper": "paper_sheet", "piece of paper": "paper_sheet",
    "cardboard": "cardboard_piece", "piece of cardboard": "cardboard_piece", "cardboard box": "cardboard_box",
    "paper bag": "paper_bag", "paper towel": "paper_towel", "tissue": "napkin_tissue", "napkin": "napkin_tissue",
    "mug": "mug", "coffee mug": "mug", "drinking glass": "drinking_glass", "glass": "drinking_glass",
    "cup": "cup_body", "paper cup": "cup_body", "plastic cup": "cup_body", "coffee cup": "cup_body", "cup lid": "cup_lid",
    "straw": "straw", "drinking straw": "straw", "plastic straw": "straw",
    "garbage can": "waste_bin", "trash can": "waste_bin", "trash bin": "waste_bin", "garbage bin": "waste_bin", "waste bin": "waste_bin", "recycling bin": "waste_bin",
    "plastic bag": "carrier_bag", "garbage bag": "waste_bag", "trash bag": "waste_bag", "foil": "foil_sheet", "aluminum foil": "foil_sheet",
    "food container": "food_container", "plastic container": "food_container", "food tray": "food_tray", "carton": "carton",
    "fork": "cutlery", "spoon": "cutlery", "knife": "cutlery", "plastic fork": "cutlery", "plastic spoon": "cutlery",
    "battery": "battery", "light bulb": "light_bulb", "cell phone": "small_electronic", "mobile phone": "small_electronic",
    "shoe": "footwear", "sneaker": "footwear", "scarf": "textile_item", "glove": "disposable_glove", "cigarette": "cigarette_butt", "cigarette butt": "cigarette_butt",
}


def propose(limit=None, source=None):
    import torch
    from transformers import AutoProcessor, Florence2ForConditionalGeneration
    from huggingface_hub import model_info
    existing = {r["id"]: r for r in read_jsonl(PROPOSALS)}
    records = read_jsonl(HOME / "manifest.jsonl")
    records = [r for r in records if r["id"] not in existing and (not source or source.lower() in r["source"]["dataset"].lower())]
    if limit is not None: records = records[:limit]
    if not records: print("All requested image proposals already exist."); return
    snapshot = HOME / "auto-labels/florence-model.json"
    revision = json.loads(snapshot.read_text())["revision"] if snapshot.exists() else model_info(MODEL).sha
    write_json(snapshot, {"model": MODEL, "revision": revision, "transformers": __import__("transformers").__version__, "task": "<OD>", "reviewStatus": "proposals_only"})
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device == "mps" else torch.float32
    processor = AutoProcessor.from_pretrained(MODEL, revision=revision)
    model = Florence2ForConditionalGeneration.from_pretrained(MODEL, revision=revision, dtype=dtype).to(device).eval()
    started = time.monotonic()
    for index, record in enumerate(records, 1):
        path = HOME / record["image"]["path"]
        try:
            with Image.open(path) as opened: image = opened.convert("RGB")
            inputs = processor(text="<OD>", images=image, return_tensors="pt").to(device, dtype)
            with torch.inference_mode(): ids = model.generate(**inputs, max_new_tokens=1024, num_beams=1, do_sample=False)
            raw = processor.batch_decode(ids, skip_special_tokens=False)[0]
            parsed = processor.post_process_generation(raw, task="<OD>", image_size=image.size)["<OD>"]
            boxes = []
            for n, (label, xyxy) in enumerate(zip(parsed.get("labels", []), parsed.get("bboxes", []))):
                left, top, right, bottom = xyxy
                boxes.append({"id": f"florence-{n}", "rawLabel": label, "label": ALIASES.get(label.lower().strip()), "bbox": [left, top, right-left, bottom-top]})
            existing[record["id"]] = {"id": record["id"], "imageSha256": record["image"]["sha256"], "createdAt": now(), "model": MODEL, "revision": revision, "boxes": boxes, "rawOutput": raw, "state": "pending_visual_review"}
        except Exception as error:
            existing[record["id"]] = {"id": record["id"], "imageSha256": record["image"]["sha256"], "createdAt": now(), "state": "error", "error": str(error)[:500]}
        if index % 25 == 0 or index == len(records):
            write_jsonl(PROPOSALS, sorted(existing.values(), key=lambda r: r["id"]))
            print(f"Image proposals {index}/{len(records)}; total {len(existing)}; elapsed {time.monotonic()-started:.1f}s", flush=True)


def sheets(offset, count, source=None, box_source="florence"):
    records = read_jsonl(HOME / "manifest.jsonl")
    if source: records = [r for r in records if source.lower() in r["source"]["dataset"].lower()]
    proposals = {p["id"]: p for p in read_jsonl(PROPOSALS)}
    records = [r for r in records if r["id"] in proposals][offset:offset + count]
    directory = ROOT / "output/training/visual-review"; directory.mkdir(parents=True, exist_ok=True)
    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
    font = ImageFont.truetype(font_path, 16)
    pages = []
    for page in range(0, len(records), 24):
        batch = records[page:page + 24]; cw, ch = 390, 330
        sheet = Image.new("RGB", (cw * 6, ch * 4), "#fafafa"); draw = ImageDraw.Draw(sheet)
        for i, record in enumerate(batch):
            proposal = proposals[record["id"]]; x, y = (i % 6) * cw, (i // 6) * ch
            draw.text((x+5, y+4), record["id"], font=font, fill="#111111")
            with Image.open(HOME / record["image"]["path"]) as opened: image = opened.convert("RGB")
            painter = ImageDraw.Draw(image)
            visible_boxes = record.get("boxes", []) if box_source == "source" else proposal.get("boxes", [])
            for b in visible_boxes:
                bx, by, bw, bh = b["bbox"]
                painter.rectangle([bx, by, bx+bw, by+bh], outline="#e43030", width=max(2, image.width//180))
            tile = ImageOps.contain(image, (cw-8, ch-64))
            sheet.paste(tile, (x+(cw-tile.width)//2, y+28))
            labels = ", ".join(b.get("label") or "?"+b.get("rawLabel", "unknown") for b in visible_boxes)
            draw.text((x+5, y+ch-31), labels[:48] or "NO DETECTIONS", font=font, fill="#111111")
        name = f"{source or 'all'}-{offset+page:04d}-{box_source}.jpg".replace(" ", "-")
        path = directory / name; sheet.save(path, quality=94)
        write_json(path.with_suffix(".json"), [{"id": r["id"], "boxSource": box_source, "sourceBoxesSha256": hashlib.sha256(json.dumps(r.get('boxes', []), sort_keys=True).encode()).hexdigest(), "proposalSha256": hashlib.sha256(json.dumps(proposals[r['id']], sort_keys=True).encode()).hexdigest()} for r in batch])
        pages.append(str(path)); print(path, flush=True)
    return pages


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("propose"); p.add_argument("--limit", type=int); p.add_argument("--source")
    p = sub.add_parser("sheets"); p.add_argument("--offset", type=int, default=0); p.add_argument("--count", type=int, default=24); p.add_argument("--source"); p.add_argument("--box-source", choices=["source", "florence"], default="florence")
    args = parser.parse_args()
    propose(args.limit, args.source) if args.command == "propose" else sheets(args.offset, args.count, args.source, args.box_source)
