# Local vision test · /scan/test

Mode: Operate. A narrow, separate camera test extending the existing camera
workspace. Inherit DESIGN.md, existing Brand, typography, system light/dark
themes, quiet neutral surfaces and orange actions. No new visual identity.

Task: load one real pretrained model, show its detections over a live camera or
local photo, compare actual after-ready timing, and save measurements. Keep the
preview primary; model choice and measurements secondary, stacked below on phone.
Default camera off. Controls are explicit here because this is a benchmark, not
the main automatic scanner. Preserve /scan and the dashboard.

Important states: idle, permission request, download, initialization, warm-up,
running, empty/uncertain detection, stopped, recoverable model error and CPU retry.
Release the camera when stopped, hidden, cancelled or navigated away. Keep media
on-device; never call the report, scan, media or Supabase APIs from this route.

Success: actual boxes fit the visible image in portrait and landscape; absent
objects disappear; controls work by keyboard and touch; photo labels remain
legible on bright and dark pixels in either theme. Acknowledge model load time
separately from capture-to-display response. Do not imply a physical-phone test,
custom 40-label coverage, material identification, overflow detection, automatic
reports or a guaranteed two-second SLA from these baseline tests.

Constraints and requested output were settled in the conversation: build the
isolated on-phone inference prototype and explain how models execute in a phone
browser. No design question remains open for this narrow implementation.

Documentation check · 2026-10-24: Compared the final component/CSS, six refreshed
captures and implementation measurements with the incumbent scanner, PRODUCT.md,
DESIGN.md and its sidecar. The extension preserves the shared brand, fonts,
system theme, neutral preview and orange action; benchmark controls and timing
layout remain scoped to this route. The guide correctly separates pretrained
80-category COCO detection from the planned custom 40-label model and Mac
synthetic-camera checks from unverified physical phones. No durable design-system
change was approved or recorded. Evidence, existing drift and limits are in
`.impeccable/review/local-vision/documentation-check.md`.
