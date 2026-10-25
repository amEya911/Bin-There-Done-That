"""Apply explicit visual-review decisions, retaining source records and reviewer identity."""
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path

from waste_data.core import ROOT, CONFIG, CLASSES, issues, now, read_jsonl, sha, write_json, write_jsonl

HOME = ROOT / CONFIG["dataRoot"]


def apply(home, file):
    home = Path(home); decisions = json.loads(Path(file).read_text())
    records = {r["id"]: r for r in read_jsonl(home / "manifest.jsonl")}
    proposals = {r["id"]: r for r in read_jsonl(home / "auto-labels/florence-proposals.jsonl")}
    updated = deepcopy(records); events = []
    for review in decisions["images"]:
        identity = review["id"]; record = updated[identity]
        if review["decision"] not in ["accept", "negative", "hold", "exclude"]: raise ValueError("Unknown review decision")
        if not review.get("note"): raise ValueError("A review decision needs its visual rationale")
        sheet = Path(decisions["sheet"])
        if not sheet.is_file(): raise ValueError("Viewed review sheet is missing")
        index = json.loads(sheet.with_suffix(".json").read_text())
        if identity not in {row["id"] for row in index}: raise ValueError("Image was not on the declared review sheet")
        if sha(home / record["image"]["path"]) != record["image"]["sha256"]: raise ValueError("Image changed after preparation")
        old = deepcopy(record)
        if review["decision"] in ["hold", "exclude"]:
            record["review"].update({"state": "needs_review" if review["decision"] == "hold" else "excluded", "reviewer": "codex:visual-review", "reviewedAt": now(), "method": "single_ai_visual_reviewer", "notes": review["note"]})
        else:
            if review["decision"] == "negative": boxes = []
            elif "boxes" in review: boxes = review["boxes"]
            elif review.get("boxSource") == "source":
                entry = next(row for row in index if row["id"] == identity)
                if entry.get("boxSource") != "source" or entry.get("sourceBoxesSha256") != hashlib.sha256(json.dumps(record["boxes"], sort_keys=True).encode()).hexdigest():
                    raise ValueError("Source boxes must be shown on the declared review sheet and remain unchanged")
                boxes = deepcopy(record["boxes"])
            elif review.get("boxSource") == "florence":
                proposal = proposals[identity]
                entry = next(row for row in index if row["id"] == identity)
                digest = hashlib.sha256(json.dumps(proposal, sort_keys=True).encode()).hexdigest()
                if digest != entry["proposalSha256"] or proposal["imageSha256"] != record["image"]["sha256"]:
                    raise ValueError("Proposals changed after visual review")
                boxes = deepcopy(proposal["boxes"])
            else: raise ValueError("An accepted review needs explicit box provenance")
            width, height = record["image"]["width"], record["image"]["height"]
            for n, box in enumerate(boxes):
                if box.get("label") not in CLASSES: raise ValueError("Unresolved source/model label cannot be accepted")
                x, y, w, h = box["bbox"]
                box.update({"id": box.get("id", f"review-{n}"), "material": "unknown", "materialBasis": "unknown", "materialReference": None, "visibility": review.get("visibility", "truncated" if min(x,y) < 1 or x+w >= width-1 or y+h >= height-1 else "clear"), "visibilityReviewed": True})
            record["boxes"] = boxes
            record["domain"] = review.get("domain", "physical_scene"); record["domainReviewed"] = True
            record["review"] = {"state": "accepted", "reviewer": "codex:visual-review", "reviewedAt": now(), "method": "single_ai_visual_reviewer", "humanVerified": False, "complete": True, "rightsChecked": True, "rightsBasis": "source_published_license_and_provenance_declaration", "groupingChecked": True, "unresolvedTargets": False, "confirmedNegative": review["decision"] == "negative", "notes": review["note"], "viewedSheet": str(sheet), "viewedSheetSha256": sha(sheet), "sourceDecisionSha256": sha(file)}
            errors = issues(record, home)
            if errors: raise ValueError(identity + ": " + ", ".join(errors))
        events.append({"at": now(), "imageId": identity, "before": old, "after": record, "decisionFileSha256": sha(file)})
    if events:
        destination = home / "reviews" / (now().replace(":", "-") + "-codex.jsonl")
        write_jsonl(destination, events)
        write_jsonl(home / "manifest.jsonl", sorted(updated.values(), key=lambda r: r["id"]))
    print("Visual review decisions applied:", len(events), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("file", type=Path); parser.add_argument("--root", type=Path, default=HOME)
    args = parser.parse_args(); apply(args.root, args.file)
