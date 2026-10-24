"""Evaluate the actual production photo pipeline against COCO box annotations.

This evaluates cup and bottle only, at the app's unchanged score threshold (.4),
NMS and 15-object cap. It neither trains/tunes models nor creates reports.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import statistics
import time
import numpy as np
from playwright.sync_api import sync_playwright
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ".data/vision-accuracy"
OUT = ROOT / "output/vision-accuracy"
OUT.mkdir(parents=True, exist_ok=True)
sample = json.loads((DATA / "sample.json").read_text())
categories = sample["categoryIds"]
id_to_name = {v: k for k, v in categories.items()}
truth = COCO(str(DATA / "subset-annotations.json"))
report = {
    "testedAt": datetime.now(timezone.utc).isoformat(),
    "hardware": "Apple M4 Mac ARM64", "sample": sample,
    "method": "100 fixed randomly selected COCO val2017 images. Actual UI photo input and unmodified production worker. Cup/bottle category matching and bounding-box IoU>=0.50, score>0.4, app NMS and maximum15 total detections per frame. Official pycocotools COCOeval handles crowd/ignore annotations. No tuning or training. This is a small selected validation subset, not independent Toronto waste data, not all80 classes and not a physical-phone test.",
    "models": {},
}

def metric(tp, fp, fn):
    return {"truePositives": tp, "falsePositives": fp, "falseNegatives": fn,
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
            "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None}


def evaluate(predictions):
    result = truth.loadRes(predictions)
    evaluator = COCOeval(truth, result, "bbox")
    evaluator.params.imgIds = sample["imageIds"]
    evaluator.params.catIds = sorted(categories.values())
    evaluator.params.iouThrs = np.array([.5])
    evaluator.evaluate()
    output = {"byClass": {}, "bySize": {}, "perImage": {}}
    for label, category in categories.items():
        rows = [x for x in evaluator.evalImgs if x and x["category_id"] == category and x["aRng"] == evaluator.params.areaRng[0]]
        tp = fp = gt = 0
        for row in rows:
            matches, ignored = row["dtMatches"][0], row["dtIgnore"][0]
            a = int(np.sum((matches > 0) & ~ignored))
            b = int(np.sum((matches == 0) & ~ignored))
            c = int(np.sum(~row["gtIgnore"].astype(bool)))
            tp += a; fp += b; gt += c
            output["perImage"].setdefault(str(row["image_id"]), {})[label] = metric(a, b, c - a)
        output["byClass"][label] = metric(tp, fp, gt - tp)
    all_classes = list(output["byClass"].values())
    output["combined"] = metric(sum(x["truePositives"] for x in all_classes), sum(x["falsePositives"] for x in all_classes), sum(x["falseNegatives"] for x in all_classes))
    for index, name in enumerate(evaluator.params.areaRngLbl[1:], 1):
        rows = [x for x in evaluator.evalImgs if x and x["aRng"] == evaluator.params.areaRng[index]]
        tp = sum(int(np.sum((x["dtMatches"][0] > 0) & ~x["dtIgnore"][0])) for x in rows)
        gt = sum(int(np.sum(~x["gtIgnore"].astype(bool))) for x in rows)
        output["bySize"][name] = {"matchedObjects": tp, "annotatedObjects": gt, "recall": tp / gt if gt else None}
    negatives = set(sample["groups"]["targetNegative"])
    bad_negative_images = {p["image_id"] for p in predictions if p["image_id"] in negatives}
    output["targetNegativeImages"] = len(negatives)
    output["negativeImagesWithTargetFalseDetection"] = sorted(bad_negative_images)
    return output


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ["VISION_BROWSER"])
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, color_scheme="light")
    context.add_init_script("""(() => {
      window.accuracyTest={frames:[],loads:[],cameraRequests:0};
      const Base=window.Worker;
      window.Worker=class extends Base {
        constructor(...args) {
          super(...args);
          this.addEventListener('message',({data})=>{
            if(data.type==='result') window.accuracyTest.frames.push(data);
            if(data.type==='ready') window.accuracyTest.loads.push(data);
          });
        }
      };
      navigator.mediaDevices.getUserMedia=async()=>{
        window.accuracyTest.cameraRequests++;
        throw new DOMException('Image-only accuracy test','NotAllowedError');
      };
    })();""")
    page = context.new_page()
    errors, writes = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: writes.append(r.url) if r.method not in ("GET", "HEAD") else None)
    page.goto("http://127.0.0.1:3000/scan/test")
    page.wait_for_load_state("networkidle")
    print("Actual UI model selector:", page.get_by_label("Test model", exact=True).input_value(), flush=True)
    for model in ("yolo26n", "rfdetr-nano"):
        page.get_by_label("Test model", exact=True).select_option(model)
        predictions, per_image = [], []
        for index, image in enumerate(sample["images"], 1):
            before = page.evaluate("window.accuracyTest.frames.length")
            started = time.monotonic()
            page.get_by_label("Choose a test photo").set_input_files(str(DATA / "images" / image["file_name"]))
            page.wait_for_function("n=>window.accuracyTest.frames.length>n || !!document.querySelector('main [role=alert]')", arg=before, timeout=60000)
            if page.locator("main [role=alert]").count():
                raise RuntimeError(page.locator("main [role=alert]").inner_text())
            actual = page.evaluate("window.accuracyTest.frames.at(-1)")
            elapsed = (time.monotonic() - started) * 1000
            row = {"imageId": image["id"], "file": image["file_name"], "uploadToResultMs": elapsed, "preprocessingMs": actual["preprocessingMs"], "inferenceMs": actual["inferenceMs"], "decodingMs": actual["decodingMs"], "allDetections": actual["detections"]}
            per_image.append(row)
            for d in actual["detections"]:
                if d["label"] not in categories:
                    continue
                box = d["box"]
                predictions.append({"image_id": image["id"], "category_id": categories[d["label"]], "bbox": [box["x"] * image["width"], box["y"] * image["height"], box["width"] * image["width"], box["height"] * image["height"]], "score": d["score"]})
            if index in (1, 50, 100):
                page.wait_for_function("!document.querySelector('[aria-busy=true]')")
                page.screenshot(path=str(OUT / f"{model}-sample-{index}.png"), full_page=True)
            if index % 20 == 0:
                print(f"{model}: {index}/100 images", flush=True)
                (OUT / f"{model}-progress.json").write_text(json.dumps(per_image, indent=2))
        (OUT / f"{model}-predictions.json").write_text(json.dumps(predictions, indent=2))
        evaluation = evaluate(predictions)
        evaluation["images"] = per_image
        evaluation["medianInferenceMs"] = statistics.median(x["inferenceMs"] for x in per_image)
        evaluation["medianWarmUploadToResultMs"] = statistics.median(x["uploadToResultMs"] for x in per_image[1:])
        evaluation["maxWarmUploadToResultMs"] = max(x["uploadToResultMs"] for x in per_image[1:])
        evaluation["load"] = page.evaluate("window.accuracyTest.loads.at(-1)")
        report["models"][model] = evaluation
        (OUT / "results.json").write_text(json.dumps(report, indent=2))
        print(model, json.dumps(evaluation["combined"]), flush=True)
    report["cameraRequests"] = page.evaluate("window.accuracyTest.cameraRequests")
    report["pageErrors"], report["networkWrites"] = errors, writes
    assert report["cameraRequests"] == 0
    assert not errors, errors
    assert not writes, writes
    (OUT / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Completed 200 real UI detections on 100 labeled validation images.", flush=True)
    browser.close()
