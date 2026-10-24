# Phone inference prototype

The separate route `/scan/test` runs real pretrained object detectors in a phone's
browser. The main `/scan` route, Gemini integration, dashboard, reporting rules,
Supabase data, evidence storage and Free plan are unchanged by this prototype.

## Use it

1. Open `/scan/test` over the public HTTPS link on the phone. Start with YOLO26 Nano.
2. Press **Start camera** and allow camera access. The camera starts only after
   that action. Alternatively, choose a local JPEG, PNG or WebP photo.
3. Wait for the model download, initialization and warm-up to finish. Hold a cup,
   bottle or another supported object in view. Labels and boxes are actual model
   outputs. Remove it to check that its box disappears.
4. Collect at least 20 live frames. Read the p50 and p95 response times and save
   the JSON results. Repeat on the same device, lighting and scene with RF-DETR.
5. Stop the camera. Leaving the page or hiding the browser also releases it.

The browser can cache the model, but may evict it. Changing the temporary tunnel
hostname changes the site's cache origin and camera permissions. The initial
download and warm-up are not included in the after-ready two-second target.

## What executes on the phone

The site sends JavaScript, ONNX Runtime Web **1.30.0**, its matching WASM binaries,
and a selected model file to the browser. It verifies the model's SHA256 hash and
creates a session inside a dedicated worker. WebGPU is requested where available,
with CPU/WASM fallback. A session can use mixed providers; the runtime label is
not proof that every operation ran on a physical GPU. A CPU retry creates a fresh
worker and selects WASM explicitly. No API key or native app is required.

For each frame, the page crops exactly the area visible in the camera preview,
limits the capture to 960 pixels on its longest side, and transfers an ImageBitmap
to the worker. Only one inference is in flight. There is no growing frame queue.
Input memory is reused. Photos preserve their full aspect ratio and are limited
to 1280 pixels on the longest side for mobile memory use.

YOLO uses a 640×640 letterbox, RGB float values from 0 to 1, its raw 80-class
head and class-aware non-maximum suppression. RF-DETR uses its documented 384×384
stretch, RGB ImageNet mean/std normalization, `dets` center-format boxes and
sigmoid `labels` scores. Official RF-DETR COCO categories are sparse IDs1–90;
ID90 remains foreground, not a discarded background slot.

The worker returns normalized boxes. The page matches same-class boxes by overlap
to keep stable identities, smooths their positions and removes unmatched tracks.
Camera results older than two seconds or from a cancelled/resized view are not
drawn; visible camera boxes expire after 900 ms without a replacement. These are
2D image annotations, not world-anchored 3D AR or physical-bin navigation.

Camera frames and selected photos stay in browser memory. This route never calls
the scan, media, report or Supabase APIs. Only model/runtime files are downloaded.
Saved benchmark JSON contains model identity, browser, timing and detected labels;
it contains no images or location. Users choose whether to save or share it.

## Models and current limits

| Baseline | ONNX download | Input | Source and license |
| --- | --- | --- | --- |
| YOLO26 Nano | 9,884,242 bytes (~10 MB) | 640×640 | [Ultralytics official checkpoint](https://huggingface.co/Ultralytics/YOLO26), AGPL-3.0 |
| RF-DETR Nano | 107,824,162 bytes (~108 MB) | 384×384 | [Roboflow RF-DETR](https://github.com/roboflow/rf-detr), Apache-2.0 |

The exported models and hashes are recorded in `public/models/vision/*.json`.
Only the chosen model is loaded; switching terminates the previous worker. The
large RF-DETR download and working memory may be unsuitable for some phones.
WASM fallback protects compatibility, but does not guarantee the speed target.

Both baselines know COCO's 80 everyday categories. They are **not trained on our
40-label catalog** and do not know overflowing bins, every waste part or material.
A detected cup is not enough to decide its disposal stream. Confidence scores
are detector scores, not calibrated material certainty. This page creates no
reports and gives no disposal directions.

After phone measurements, select the smallest model that meets latency and
accuracy goals. Then prepare licensed, grouped train/validation/test data for the
versioned object catalog and separate bin-condition task. Compare precision,
recall, false overflow alerts and small-part recall on held-out scenes. Only the
validated waste outputs should connect to Toronto's rules, disposal arrows,
GPS/bin matching and the existing repeated-evidence reporting safeguards.

## Evidence from implementation checks

2026-10-24, Apple M4 Mac, headless Chromium149, ONNX Runtime Web with the WebGPU
provider and CPU fallback requested:

- Both actual models detected `cup` in the CC0 test fixture.
- YOLO photo response was about **0.15 s**; RF-DETR about **0.66–0.67 s**.
- A 20-frame synthetic-camera run used real inference, with YOLO p50 about
  **0.13 s** and p95 about **0.14–0.15 s**.
- The fixture disappeared when removed from the video. Stopping and cancelling a
  late camera permission released all tracks. Initial page load opened no camera.
- Phone-width light/dark layouts had no horizontal overflow. No JavaScript page
  errors or network writes occurred during the browser smoke test.
- Explicit CPU/WASM runs also detected the cup in both models (about 0.13 s
  YOLO inference and 0.64 s RF-DETR inference on this Mac).
- The existing tests plus new decoding/geometry/tracking tests passed: **39/39**.

These are development checks, not an accuracy study or a physical-phone latency
result. Cold loading, thermal throttling, battery use, mobile memory pressure,
actual iPhone/Android browsers and poor-light/occlusion performance still require
device testing. Timing includes capture through delivery to a display animation
frame; it cannot measure when a physical object first entered the scene or the
screen's exact hardware presentation time. p50/p95 use the latest 200 frames.

Raw measurements and screenshots are local under `output/vision-verification/`
and `.impeccable/review/local-vision/`. They are ignored by Git.

## Reproduce the model assets

Export tools are isolated from the website. They perform no training or cloud jobs.

```sh
uv venv .data/vision-tools --python 3.12
uv pip install --python .data/vision-tools/bin/python -r scripts/vision-tools-requirements.txt
.data/vision-tools/bin/python scripts/export-vision-models.py
npm ci
npm run build
```

The export script downloads official public checkpoints, verifies the pinned YOLO
checkpoint hash (RF-DETR's package verifies its published MD5), exports fixed-shape
FP32 graphs, embeds weights in each ONNX file and writes content-hashed filenames
and manifests. Weight files and copied runtime binaries are ignored by Git.
The verified checkpoint must be reviewed explicitly if a provider changes it.
`npm ci` runs the asset-preparation script, copying matching runtime files locally.
Do not run untrusted checkpoint files through the exporter.

For browser verification, run a production preview on port3003 and set
`VISION_BROWSER` to a local headless Chromium executable, then run
`.data/vision-tools/bin/python scripts/verify-local-vision.py`.
It uses a canvas-based fixture camera and never requests the Mac's real webcam.
Fixture source and license are in `tests/fixtures/vision/SOURCES.md`.

Reference documentation:
[ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html),
[WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html),
[runtime configuration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html),
[RF-DETR ONNX preprocessing and outputs](https://rfdetr.roboflow.com/latest/exports/onnx/).
