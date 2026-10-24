from copy import deepcopy
import json
from pathlib import Path
from urllib.parse import quote
from .core import CLASSES, CONDITIONS, REVIEW_SENTINEL, SPEC, coverage, issues, now, read_jsonl, sha, write_json, write_jsonl


def choices(name, values, region=False, multiple=False, required=True):
    attrs = f'name="{name}" toName="image" choice="{"multiple" if multiple else "single"}"'
    if region: attrs += ' perRegion="true"'
    if required: attrs += ' required="true"'
    return f'<Choices {attrs}>' + "".join(f'<Choice value="{v}"/>' for v in values) + '</Choices>'


def config():
    labels = "".join(f'<Label value="{name}"/>' for name in [*CLASSES, REVIEW_SENTINEL])
    return '<View><Header value="Object and part annotation — proposals require review"/><Text name="source_notes" value="$source_notes"/><Image name="image" value="$image" zoom="true"/><RectangleLabels name="objects" toName="image">' + labels + '</RectangleLabels><View visibleWhen="region-selected"><Header value="Selected object attributes"/>' + choices("visibility", SPEC["annotationAttributes"]["visibility"], True) + choices("material", SPEC["annotationAttributes"]["material"], True) + choices("material_basis", SPEC["annotationAttributes"]["materialBasis"], True) + '<TextArea name="material_reference" toName="image" perRegion="true" placeholder="Product information or marking reference; required for non-unknown material"/></View><Header value="Image review"/>' + choices("review_status", ["complete", "needs_review", "excluded"]) + choices("domain", SPEC["annotationAttributes"]["domain"]) + choices("checks", ["all_visible_targets_reviewed", "source_rights_checked", "related_image_groups_checked", "confirmed_no_targets"], multiple=True, required=False) + '<TextArea name="review_notes" toName="image" placeholder="Ambiguity, deleted source regions, grouping corrections or exclusions"/></View>'


def condition_config():
    return '<View><Header value="One bin crop: inspect the opening and source of spillage"/><Image name="image" value="$image"/>' + choices("condition", [*CONDITIONS, "unverifiable"]) + choices("quality", SPEC["annotationAttributes"]["qualityFlags"], multiple=True, required=False) + choices("checks", ["opening_visible", "spillage_origin_checked"], multiple=True, required=False) + choices("review_status", ["complete", "needs_review", "excluded"]) + '<TextArea name="review_notes" toName="image" placeholder="Explain an unverifiable opening or uncertain spillage source"/></View>'


def tasks(records, prelabels=True):
    output = []
    for r in records:
        image = r["image"]; w, h = image["width"], image["height"]
        notes = "Source: " + r["source"].get("dataset", "own capture") + ". " + "; ".join(sorted({b.get("sourceCategory", b["label"]) for b in r.get("boxes", [])}))
        if r["source"].get("sourceImageLabel"):
            notes += " Source image category: " + r["source"]["sourceImageLabel"] + ". No source object boxes; draw all supported instances. Image category is not a verified material attribute."
        item = {"data": {"image": "/data/local-files/?d=" + quote(image["path"]), "dataset_id": r["id"], "source_notes": notes if prelabels else "Independent pilot annotation: label every identifiable supported target using the guide."}, "meta": {"dataset_id": r["id"], "source": r["source"], "groups": r["groups"]}}
        if prelabels and r.get("boxes"):
            result = []
            for b in r.get("boxes", []):
                x, y, bw, bh = b["bbox"]
                result.append({"id": b["id"], "from_name": "objects", "to_name": "image", "type": "rectanglelabels", "original_width": w, "original_height": h, "image_rotation": 0, "value": {"x": x / w * 100, "y": y / h * 100, "width": bw / w * 100, "height": bh / h * 100, "rotation": 0, "rectanglelabels": [b["label"]]}})
            item["predictions"] = [{"model_version": "source-annotation-proposals-v1", "result": result}]
        output.append(item)
    return output


def prepare(home, records, conditions):
    directory = Path(home) / "label-studio"
    (directory / "objects.xml").write_text(config())
    (directory / "conditions.xml").write_text(condition_config())
    write_json(directory / "object-tasks.json", tasks(records))
    # Same small batch, no imported boxes: the two pilot passes remain independent.
    pilot, seen = [], set()
    remaining = sorted(records, key=lambda r: r["id"])
    while remaining and len(pilot) < 20:
        selected = max(remaining, key=lambda r: len({b["label"] for b in r.get("boxes", []) if b["label"] != REVIEW_SENTINEL} - seen))
        pilot.append(selected); remaining.remove(selected)
        seen.update(b["label"] for b in selected.get("boxes", []) if b["label"] != REVIEW_SENTINEL)
    for name in ["pilot-a-tasks.json", "pilot-b-tasks.json"]:
        if not (directory / name).exists(): write_json(directory / name, tasks(pilot, prelabels=False))
    write_json(directory / "condition-tasks.json", [{"data": {"image": "/data/local-files/?d=" + quote(c["image"]["path"]), "dataset_id": c["id"]}} for c in conditions])
    print("Annotation configs, prelabels and two independent20-image pilot queues prepared.")


def import_reviews(home, file):
    home = Path(home); incoming = json.loads(Path(file).read_text())
    if isinstance(incoming, dict): incoming = incoming.get("tasks", [])
    records = {r["id"]: r for r in read_jsonl(home / "manifest.jsonl")}
    updated = deepcopy(records); events = []
    conditions = {c["id"]: c for c in read_jsonl(home / "conditions.jsonl")}
    changed_conditions = deepcopy(conditions)
    for task in incoming:
        identity = task.get("data", {}).get("dataset_id")
        if identity not in records and identity not in conditions: raise ValueError("Unknown dataset image in annotation export")
        annotations = [a for a in task.get("annotations", []) if not a.get("was_cancelled")]
        if not annotations: continue  # Predictions alone never become accepted truth.
        if len(annotations) != 1: raise ValueError("Multiple annotations need explicit reconciliation; not latest-wins")
        annotation = annotations[0]; result = annotation.get("result", [])
        def values(name, region=None):
            entries = [x for x in result if x.get("from_name") == name and (region is None or x.get("id") == region)]
            return [v for entry in entries for v in entry.get("value", {}).get("choices", [])]
        def text(name, region=None):
            return " ".join(t for x in result if x.get("from_name") == name and (region is None or x.get("id") == region) for t in x.get("value", {}).get("text", []))
        state = values("review_status")
        if len(state) != 1: raise ValueError("Annotation needs an explicit review decision")
        reviewer = annotation.get("completed_by")
        if isinstance(reviewer, dict): reviewer = reviewer.get("id")
        if not reviewer: raise ValueError("Annotation export lacks reviewer identity")
        if identity in conditions:
            c = changed_conditions[identity]; labels = values("condition"); flags = values("quality"); notes = text("review_notes"); checks = set(values("checks"))
            if len(labels) != 1 or labels[0] not in [*CONDITIONS, "unverifiable"]: raise ValueError("Condition needs one reviewed label")
            if labels[0] == "unverifiable" and not flags and not notes: raise ValueError("Unverifiable condition needs a reason")
            c["condition"] = None if labels[0] == "unverifiable" else labels[0]
            c["qualityFlags"] = flags
            c["review"] = {"state": "needs_review" if labels[0] == "unverifiable" else {"complete": "accepted", "needs_review": "needs_review", "excluded": "excluded"}[state[0]], "reviewer": f"label-studio-user:{reviewer}", "reviewedAt": annotation.get("updated_at") or now(), "openingVisible": "opening_visible" in checks, "spillageOriginChecked": "spillage_origin_checked" in checks, "notes": notes}
            if c["review"]["state"] == "accepted" and not (c["review"]["openingVisible"] and c["review"]["spillageOriginChecked"]): raise ValueError("Accepted bin condition needs visible opening and spillage-origin checks")
            events.append({"at": now(), "conditionId": identity, "review": c["review"], "importSha256": sha(file)})
            continue
        r = updated[identity]; w, h = r["image"]["width"], r["image"]["height"]
        boxes = []
        for x in result:
            if x.get("from_name") != "objects" or x.get("type") != "rectanglelabels": continue
            v = x["value"]; labels = v.get("rectanglelabels", [])
            if len(labels) != 1: raise ValueError("Each region needs exactly one canonical label")
            if x.get("original_width") != w or x.get("original_height") != h or v.get("rotation", 0) != 0:
                raise ValueError("Image dimensions/rotation changed; recheck coordinate conversion")
            region = x["id"]; material = values("material", region); visibility = values("visibility", region); basis = values("material_basis", region)
            if len(material) != 1 or len(visibility) != 1 or len(basis) != 1: raise ValueError("Every box needs material, basis and visibility review")
            boxes.append({"id": region, "label": labels[0], "bbox": [v["x"] * w / 100, v["y"] * h / 100, v["width"] * w / 100, v["height"] * h / 100], "material": material[0], "materialBasis": basis[0], "materialReference": text("material_reference", region) or None, "visibility": visibility[0], "visibilityReviewed": True})
        checks = set(values("checks")); domains = values("domain")
        if len(domains) != 1: raise ValueError("Image domain needs review")
        r["boxes"] = boxes; r["domain"] = domains[0]; r["domainReviewed"] = True
        r["review"] = {"state": {"complete": "accepted", "needs_review": "needs_review", "excluded": "excluded"}[state[0]], "complete": "all_visible_targets_reviewed" in checks, "rightsChecked": "source_rights_checked" in checks, "groupingChecked": "related_image_groups_checked" in checks, "unresolvedTargets": any(b["label"] == REVIEW_SENTINEL for b in boxes), "confirmedNegative": "confirmed_no_targets" in checks, "reviewer": f"label-studio-user:{reviewer}", "reviewedAt": annotation.get("updated_at") or now(), "notes": text("review_notes")}
        errors = issues(r, home)
        if errors: raise ValueError(f"{identity}: " + ", ".join(errors))
        events.append({"at": now(), "imageId": identity, "annotationId": annotation.get("id"), "review": r["review"], "importSha256": sha(file)})
    if events:
        write_jsonl(home / "reviews" / (now().replace(":", "-") + ".jsonl"), events)
        write_jsonl(home / "manifest.jsonl", sorted(updated.values(), key=lambda r: r["id"]))
        write_jsonl(home / "conditions.jsonl", sorted(changed_conditions.values(), key=lambda c: c["id"]))
    print("Reviewed image updates imported:", len(events))
