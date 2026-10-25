# Production camera and historical model experiments

The public camera now lives at `/scan`; `/scan/test` redirects there. It opens the
rear camera unless `camera=off` is requested, waits two seconds, takes one photo,
and keeps the result until Retake. The public screen has no upload/model controls,
item descriptions, response timings, result export or footer. The camera analysis
remains transient; a confirmed report saves its evidence in private Supabase
Storage. Supabase Free is unchanged. Browser-only detector comparisons described
later in this document are historical experiments and are no longer exposed by
the public camera route.

## Gemini camera

Save the key in ignored, private `.env.local` as `GEMINI_API_KEY`. The current
lower-latency configuration is `GEMINI_MODEL=gemini-3.5-flash-lite`; model selection
is server-side. A key is never sent to the browser. Opening `/scan` starts the
rear-camera attempt; `/scan?camera=off` waits for **Take photo**. Once camera
playback is ready, a two-second countdown takes
one photo regardless of movement. There is no motion comparison or centre guide.
**Capture photo** also lets the user take the photo earlier. Exactly one image is
resized to at most768 pixels and sent to
`POST /api/vision/preview`. That endpoint validates the request and provider output,
applies Toronto rules, and returns per-component boxes and instructions. It saves
no images or scans during analysis; session, quota and connection-health records
still use the configured database. It shares the application's daily scan allowance.
An overflowing-bin result automatically opens `/report?draft=<id>`. Its per-tab
draft holds the exact photo, timestamp, overflow issue and visible evidence for15
minutes. The report page finds the nearest bin using GPS, supports street/bin
search, and uploads the held photo only when the user submits. Successful reports
use the normal shared database and private media storage; save/discard removes
the stored draft. Recognizing a bin does not publish a report. Blocked browser
storage falls back to the existing inline confirmation form.

A cup body, visible lid, straw and sleeve can receive separate arrows. Recognizable
parts receive broad-material estimates and direct disposal instructions, labeled
**Paper · recycling**, **Recycling**, **Organics** or **Garbage / litter**.
Paper is a recycling subcategory; litter refers to the garbage opening. Tissues
and food-soiled uncoated paper are handled separately from clean paper recycling.
Estimation metadata remains internal.
Reusable parts receive
reuse guidance. Only genuinely unidentified or unusable views ask for a clearer
view. The project straw override maps plastic to Litter and paper to Paper ·
recycling, with internal source `project:straw-sorting`. It is separate from the
City Waste Wizard snapshot in `training/toronto-cup-rules-2026-10-24.json` used
for other source-backed mappings. Arrows label parts with guidance; they do not
invent the position or accepted stream of a physical bin. A detected bin alone
does not establish overflow or its physical Toronto asset identity.

The countdown starts after camera playback is ready. Movement, hand shake and
background traffic do not reset it. Retaking starts a fresh two-second timer;
cancellation, leaving the page and hiding the tab cancel the pending capture.
Unreadable or stopped camera playback shows a retry state instead of a successful
analysis. The two-second framing delay is separate from provider response time.

After one ready frame is captured, every camera track stops before the request.
The exact JPEG appears immediately, then its arrows remain until the next attempt.
There is no background capture loop. **Retake photo** starts one new camera/capture
attempt and cancels any pending request. Hiding the page or changing models cancels
work and releases tracks; a late response from a prior attempt cannot replace a
new photo. Frozen-image coordinates remain aligned after resizing.

Timing measures capture through the displayed response, including networking.
The two-second target is not guaranteed. Actual provider/photo verification is
recorded in ignored `output/gemini/`; separate mocked synthetic-video UI tests
are under `output/training/gemini-preview-ui-qa/`. Earlier steady-capture checks
under `output/training/steady-preview-qa/` and
`output/training/steady-main-qa/` describe a superseded capture flow. Current
`timed-report-results.json`, `timed-local-results.json`, `timer-results.json`,
and `timer-overflow-results.json` in those folders verify the two-second flow.
The restored public-link check is under `output/training/timed-public-qa/`.
Two actual provider smoke-test photos and returned observations are recorded in
`output/training/timed-ai-smoke/results.json`; no reports were submitted.
Mocked timings are not API speed
measurements. Physical-phone recognition and latency still require testing.

## Use it

1. Open `/scan/test` over the public HTTPS link on the phone. Choose a local model
   explicitly for the browser-only comparison described below.
2. Press **Take photo** and allow camera access. The camera starts only after
   that action. Alternatively, choose a local JPEG, PNG or WebP photo.
3. Local models download and initialize before opening hardware. One ready frame
   is captured and held with actual model labels and boxes.
4. Read that photo's response time. Retake explicitly to analyze another image;
   changing the real scene does not alter the held result.
5. For comparisons, repeat the same photo/device setup with another model.

The **Trained waste detector · experimental** option loads the first source-supervised
YOLO checkpoint. It uses its own66-class manifest instead of COCO IDs and draws
actual numbered AR callouts. These local-model callouts do not establish a sorting
recommendation; object appearance does not verify composition or bin condition. The first
held-out results are weak and include incorrect detections. This option is for
inspection, not automatic reporting. See [training status](../training/README.md).

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

The worker returns normalized boxes for the exact captured image. Cancelled
attempts cannot replace newer results. Boxes stay on the still and are recalculated
against its contained-image rectangle on resize; they do not expire. These are
2D image annotations, not world-anchored 3D AR or physical-bin navigation.

In the local model modes, camera frames and selected photos stay in browser memory.
Those modes never call the scan, preview, media, report or Supabase APIs. Only
model/runtime files are downloaded. The Gemini option sends selected images as
described above.
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
reports. Only the Gemini option supplies source-backed disposal guidance.

After phone measurements, select the smallest model that meets latency and
accuracy goals. Then prepare licensed, grouped train/validation/test data for the
versioned object catalog and separate bin-condition task. Compare precision,
recall, false overflow alerts and small-part recall on held-out scenes. Only the
validated waste outputs should connect to Toronto's rules, disposal arrows,
GPS/bin matching and the existing repeated-evidence reporting safeguards.

## Historical continuous-prototype checks

Before the one-photo redesign,2026-10-24, Apple M4 Mac, headless Chromium149, ONNX Runtime Web with the WebGPU
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
