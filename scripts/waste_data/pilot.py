import json
from .core import now, write_json


def compare(first, second, output):
    def load(path):
        result = {}
        for task in json.loads(path.read_text()):
            annotations = [a for a in task.get("annotations", []) if not a.get("was_cancelled")]
            if len(annotations) != 1: raise ValueError("Pilot comparison needs exactly one submitted annotation per task")
            a = annotations[0]; reviewer = a.get("completed_by")
            if isinstance(reviewer, dict): reviewer = reviewer.get("id")
            boxes = [(r["value"]["rectanglelabels"][0], [r["value"][k] for k in ["x", "y", "width", "height"]]) for r in a["result"] if r.get("from_name") == "objects" and r.get("type") == "rectanglelabels"]
            result[task["data"]["dataset_id"]] = {"reviewer": reviewer, "boxes": boxes}
        return result
    a, b = load(first), load(second)
    if not a or set(a) != set(b): raise ValueError("Pilot exports must contain the same non-empty image set")
    def iou(x, y):
        area = max(0, min(x[0] + x[2], y[0] + y[2]) - max(x[0], y[0])) * max(0, min(x[1] + x[3], y[1] + y[3]) - max(x[1], y[1]))
        return area / max(1e-9, x[2] * x[3] + y[2] * y[3] - area)
    rows = []
    for identity in a:
        if not a[identity]["reviewer"] or not b[identity]["reviewer"] or a[identity]["reviewer"] == b[identity]["reviewer"]:
            raise ValueError("Pilot A and B must be submitted by different reviewer accounts")
        used = set(); matched = 0
        for label, box in a[identity]["boxes"]:
            candidates = [(iou(box, other), index) for index, (name, other) in enumerate(b[identity]["boxes"]) if name == label and index not in used]
            if candidates:
                score, index = max(candidates)
                if score >= .7: used.add(index); matched += 1
        rows.append({"imageId": identity, "reviewerABoxes": len(a[identity]["boxes"]), "reviewerBBoxes": len(b[identity]["boxes"]), "sameClassMatchesAtIoU70": matched, "needsReconciliation": matched != len(a[identity]["boxes"]) or matched != len(b[identity]["boxes"])})
    write_json(output, {"createdAt": now(), "status": "comparison_only", "images": rows, "needsReconciliation": [r["imageId"] for r in rows if r["needsReconciliation"]], "note": "Box agreement is not accuracy. Reconcile material, visibility, completeness and label-definition disagreements too. This report never auto-accepts a dataset or activates a model."})
    print("Pilot comparison saved:", output)
