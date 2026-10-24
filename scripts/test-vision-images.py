"""Upload real images through the running app and preserve its unmodified outputs.

No real webcam, mocked model results, server mutations, or resident photos.
Requires the isolated vision-tools environment and VISION_BROWSER executable.
"""
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import statistics
import time
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/vision-image-tests"
OUT.mkdir(parents=True, exist_ok=True)
Image.new("RGB", (960, 720), (190, 190, 190)).save(OUT / "empty-control.png")
CASES = [
    ("cup", ROOT / "tests/fixtures/vision/coffee-cup.jpg", ["cup"]),
    ("bottle", ROOT / "tests/fixtures/vision/water-bottle.jpg", ["bottle"]),
    ("bottle-pack", ROOT / "tests/fixtures/vision/water-bottle-pack.jpg", ["bottle"]),
    ("kitchen", ROOT / ".data/model-export/coco-397133.jpg", ["person", "bowl"]),
    ("overflow-bin", ROOT / "public/images/overflow-bin-hamburg.jpg", []),
    ("street-bus", ROOT / ".data/model-export/bus.jpg", ["bus", "person"]),
    ("empty-control", OUT / "empty-control.png", []),
]

def median(values):
    return round(statistics.median(values), 2)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ["VISION_BROWSER"])
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, color_scheme="light", accept_downloads=True)
    # Observe actual worker responses. Neither predictions nor timing are replaced.
    context.add_init_script("""(() => {
      window.imageTest = { results: [], cameraRequests: 0 };
      const OriginalWorker = window.Worker;
      window.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({data}) => {
            if (data.type === 'result') window.imageTest.results.push(data);
          });
        }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        window.imageTest.cameraRequests++;
        throw new DOMException('Image-only test: camera access is disabled', 'NotAllowedError');
      };
    })();""")
    page = context.new_page()
    errors, writes = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: writes.append({"method": r.method, "url": r.url}) if r.method not in ("GET", "HEAD") else None)
    page.goto(os.environ.get("VISION_TEST_URL", "http://127.0.0.1:3000/scan/test"))
    page.wait_for_load_state("networkidle")
    print("Default selected model:", page.get_by_label("Test model", exact=True).input_value(), flush=True)
    print("Visible controls:", page.get_by_role("button").all_text_contents(), flush=True)
    report = {"testedAt": datetime.now(timezone.utc).isoformat(), "hardware": "Apple M4 Mac, ARM64", "browser": browser.version, "url": page.url, "method": "Real UI photo input, same unmodified production worker, three repetitions per scene/model. After-ready UI timing excludes model load and photo decoding; upload-to-result wall time includes upload/decode and includes first model load when needed. This is not a phone or broad accuracy benchmark.", "results": []}
    for model in ("yolo26n", "rfdetr-nano"):
        page.get_by_label("Test model", exact=True).select_option(model)
        for scene, file, expected in CASES:
            runs = []
            for repeat in range(3):
                before = page.evaluate("window.imageTest.results.length")
                started = time.monotonic()
                page.get_by_label("Choose a test photo").set_input_files(str(file))
                page.wait_for_function("n => window.imageTest.results.length > n || !!document.querySelector('main [role=alert]')", arg=before, timeout=60000)
                if page.locator("main [role=alert]").count():
                    raise RuntimeError(page.locator("main [role=alert]").inner_text())
                page.get_by_role("button", name="Save test results").wait_for(state="visible")
                page.wait_for_function("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save test results'))?.disabled === false && !document.querySelector('[aria-busy=true]')")
                upload_ms = (time.monotonic() - started) * 1000
                actual = page.evaluate("window.imageTest.results.at(-1)")
                with page.expect_download() as download_info:
                    page.get_by_role("button", name="Save test results").click()
                saved = OUT / f"{model}-{scene}-{repeat + 1}.json"
                download_info.value.save_as(str(saved))
                exported = json.loads(saved.read_text())
                assert exported["sampleCount"] == 1, "Photo tests must reset stale measurements"
                assert sorted(exported["samples"][0]["detected"]) == sorted(d["label"] for d in actual["detections"])
                runs.append({"responseMs": exported["samples"][0]["totalMs"], "uploadToResultMs": upload_ms, "inferenceMs": actual["inferenceMs"], "detections": actual["detections"]})
                if repeat == 0:
                    page.screenshot(path=str(OUT / f"{model}-{scene}.png"), full_page=True)
            labels = sorted(set(d["label"] for d in runs[-1]["detections"]))
            entry = {"model": model, "scene": scene, "image": str(file.relative_to(ROOT)), "expectedPrimaryLabels": expected, "expectedLabelsPresent": all(label in labels for label in expected), "labels": labels, "detections": runs[-1]["detections"], "medianResponseMs": median([r["responseMs"] for r in runs]), "maxResponseMs": round(max(r["responseMs"] for r in runs), 2), "firstUploadToResultMs": round(runs[0]["uploadToResultMs"], 2), "subsequentMedianUploadToResultMs": median([r["uploadToResultMs"] for r in runs[1:]]), "loadMs": exported["load"]["totalLoadMs"], "runtime": exported["runtime"], "runs": runs}
            report["results"].append(entry)
            print(model, scene, labels, f"median {entry['medianResponseMs']}ms", "boxes", len(entry["detections"]), flush=True)
    report["cameraRequests"] = page.evaluate("window.imageTest.cameraRequests")
    report["pageErrors"], report["networkWrites"] = errors, writes
    assert report["cameraRequests"] == 0
    assert not errors, errors
    assert not writes, writes
    assert not page.locator("video").evaluate("v => !!v.srcObject")
    (OUT / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    with (OUT / "results.csv").open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["model", "image", "detected labels", "boxes", "median processing ms (3 runs)", "max processing ms", "warm upload-to-result median ms"])
        for result in report["results"]:
            writer.writerow([result["model"], result["scene"], "; ".join(result["labels"]), len(result["detections"]), result["medianResponseMs"], result["maxResponseMs"], result["subsequentMedianUploadToResultMs"]])
    print("Completed 42 real UI image tests. No camera access or network writes.", flush=True)
    browser.close()
