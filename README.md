# Bin There Done That

A camera-first Toronto waste companion, with a live inventory map, source-backed sorting guidance, community observations and an operator follow-through workflow.

The app uses **Supabase PostgreSQL + PostGIS** for shared data and **private Supabase Storage** for retained images. The existing production server is shared through Nginx and a temporary Cloudflare Tunnel. The application server still runs on this computer; the database and image objects are managed by Supabase. This repository contains project source and preparation tools; credentials, local databases and downloaded training images are excluded.

## Run locally

Use Node.js **24.x**, matching the Vercel production runtime.

```sh
npm install
npm run import:bins
cp .env.example .env.local
# Fill in this project's existing server-side Supabase credentials.
npm run dev
```

Open [the dashboard](http://localhost:3000/dashboard). On a phone, the root route defaults to `/scan`; computers default to `/dashboard`. Explicit routes work on both.

Open [connection setup](http://localhost:3000/setup) on the computer running the app. Choose a management password of at least 12 characters. Add a Gemini API key when available, then use **Test connection**. Keys are server-only; the active Gemini key and database/storage credentials are in ignored `.env.local`. Management settings and anonymous sessions persist in the private database schema. No credential is returned by the status API. You may alternatively copy `.env.example` to `.env.local` and configure it there; environment values take precedence.

Without a usable Gemini connection, the inventory map and heatmaps, manual issue reporting, case management, bin registration and demo setup work. Live AI analysis explicitly reports that a connection is required. There are **no simulated detections or seeded public reports**.

## Main routes

| Route                  | Purpose                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `/scan`                | One-photo rear-camera capture, fixed component arrows, retake and confirmed photo reports                 |
| `/scan?camera=off`     | Preview scanner without opening hardware; the on button starts it explicitly                            |
| `/dashboard`           | Inventory, bin-density and report-density maps, live report feed, separate counts                       |
| `/bins/:id`            | Asset provenance, observations and case history                                                         |
| `/receipts/:id#key=…`  | Private receipt, recovery and withdrawal                                                                |
| `/bins/new`            | Photo and automatic-location flow for community additions                                              |
| `/manage/bins`         | Designated areas, physical-bin registration and approval                                                |
| `/manage/cases`        | Private evidence, assignment, work completion, recheck, merge/split, bin association and handoff packet |
| `/manage/demo`         | Selected-asset demo creation and private scanner QR                                                     |
| `/setup`               | Local Gemini and management configuration                                                               |
| `/about`               | Product behavior, limits and source attribution                                                         |
| `/demo/:id/scan#key=…` | Private demo writer; real camera pipeline                                                               |
| `/demo/:id/dashboard`  | Isolated live demo dashboard                                                                            |
| `/demo/:id/present`    | Projectable photo and live demo counters                                                                |

Demo operators can review cases at `/manage/cases?scope=demo:SESSION_ID`. The demo dashboard links there.

## Architecture in this checkout

- **Next.js App Router + React + TypeScript** serve the application and API on one origin.
- **MapLibre** renders the supplied City inventory and separate heatmaps; OpenFreeMap supplies the attributed basemap. Version-matched worker files are prepared on installation.
- **Gemini Interactions API**, initially `gemini-3.8-flash`, analyzes selected compressed frames through a server-side adapter. Zod validates its observations. Material-specific disposal advice comes from reviewed Toronto rules, rather than model-created local rules.
- **Supabase PostgreSQL + PostGIS** stores bins, areas, cases and reports with foreign keys, spatial columns and GiST indexes. Nearby-bin and designated-area checks run in the database. Transactions, database-backed sessions, request idempotency and shared quotas work across visitors. The dashboard polls every 3.5 seconds and reads its counters from one consistent database snapshot.
- **Private Supabase Storage** holds sanitized JPEG evidence. Continuous video is never stored. Unreported scan images expire after ten minutes; accepted evidence defaults to seven days. Expired images cannot be read; hourly maintenance removes their objects while a server is running. `npm run data:cleanup` is also available. Runtime images are never written to this computer in Postgres mode.
- **Server-controlled access** keeps the browser on the same-origin Next.js API. RLS is enabled, direct browser table grants are revoked, and auxiliary records live in `app_private`. Public report projections are shared; notes, evidence, session hashes and recovery secrets remain private. This deliberately does not introduce Supabase Auth or change the existing anonymous receipt/operator-login flows.

The configured project remains on **Supabase Free**, with no paid compute, plan upgrade or paid add-on. SQLite is retained only as an isolated test adapter and a pre-cutover rollback source. `DATA_BACKEND=postgres` selects the live cloud backend. See [cloud operations](docs/cloud-storage.md) for configuration, migration and retention details.

Read [the implementation decisions](docs/implementation-decisions.md), [API contract](docs/api.md), and [verification record](docs/verification.md).

Read [the project review and detailed AR architecture](docs/hackathon-review-and-ar.md) for the camera-to-map sequence, current limits, review improvements, and physical demo validation plan.

The first custom-model training scope is defined in the [AI recognition and annotation specification](docs/ai-recognition-spec.md). Its versioned class definitions and label lists live in [training/](training/README.md). These definitions prepare the next recognition pipeline; the active scanner still uses its existing Gemini adapter.

## Inventory and designated areas

The supplied `Street furniture-Litter receptacle data - 4326.geojson` is preserved unchanged. `npm run import:bins` validates unique City IDs, normalizes single-point MultiPoints to Points and writes a compact active inventory plus provenance/hash manifest into `public/data/`.

The import has 10,457 records: 9,822 Existing and 635 Temporarily Removed. Stable internal UUIDs derive from City asset IDs; duplicate coordinates, site IDs and barcodes do not merge different assets. Reimporting leaves local manual bins and report links intact.

An initial **Downtown pilot area** is an application-defined rectangle, not an official Toronto service boundary. Administrators can add other designated polygons. Manual additions must be inside an active area, including the boundary. Another approved or pending bin within 15 m blocks registration, with no override. Residents can add a photo and fresh GPS location at `/bins/new`, without management login. Location must be no older than two minutes and accurate to 25 m; the server assigns the active containing area. Photo evidence remains private and follows the existing retention policy. Community additions appear immediately and are labeled as community records, not City-verified assets. Operator-created pending/rejected additions stay out of public matching and maps. Approved records are labeled Community-added and receive no invented City ID.

## Photo reports and honest counts

The camera captures one photo per attempt. A supported overflowing-bin result automatically opens `/report?draft=<id>` with the exact photo, original capture time, overflowing issue and visible evidence filled in. GPS suggests the nearest registered bin; the resident can search for another and explicitly submit. The per-tab draft expires after15 minutes, contains no photo in its URL and uploads the photo only on submission. Save/discard removes the stored draft. Sorting does not require GPS.

The server's automatic-report endpoint still requires an active physical bin and two distinct, fresh server-held camera observations from the same session and scope: high-certainty overflow, visible evidence, no quality defects and overlapping target boxes. The one-photo interface does not fabricate a second observation or bypass that safeguard. Recent accurate GPS can select a bin only when the candidate is unambiguous; otherwise the user selects a physical bin.

The server commits the observation and case together. Request retries return the original record. Continued camera reports from the same session/bin are suppressed for 30 minutes, except that a completed episode permits new evidence to open a new episode. Reports from separate sessions are **not claimed to be independent corroboration**.

Three accepted observations can mean three reports, one case and one affected bin. Heatmaps and map badges count reports from open cases within the selected window; accepted resolved reports remain in bin history. The headline **Open reports**, feed, map highlights, affected-bin and open-case counts exclude closed cases. `historicalReports` is the separate accepted-history count. These observations are not a cleanliness score. Work completion, observed condition and external delivery remain separate. No report or handoff packet is automatically sent to Toronto 311.

## Camera behavior and phone access

The first scanner entry requests the rear camera without audio. Once camera playback is ready, a two-second countdown takes exactly one photo, regardless of movement. There is no motion comparison or centre framing guide. **Capture photo** is an explicit early-capture option. Every camera track stops before analysis. Item photos remain visible with numbered disposal arrows. **Retake photo** starts a fresh two-second countdown and cancels the prior request. Leaving or hiding the scanner releases hardware and cancels work, including late permission grants. Frozen photos and arrows use matching contained-image coordinates across viewport changes. An overflowing-bin result opens the prefilled report page. A detection alone does not publish a report. When browser draft storage is blocked, the existing inline/modal report form remains available.

The scanner always uses automatic scene selection. The mode selector, pause/capture/upload strip, idle feedback block and manual item lookup were removed following user feedback. Automatic GPS matching starts with the camera and selects only an unambiguous nearby physical bin. The manual-report form independently requests location, suggests the nearest registered bin with its name and distance, and always allows street/City ID search. Sorting items does not require a matched bin.

Both the scanner and dashboard follow `prefers-color-scheme` automatically, including the basemap, form surfaces and browser theme metadata. The scanner header contains only the brand, which links to the dashboard. Provider setup/billing cards and persistent location controls are absent.

The dashboard uses a horizontal header, four distinct overview counts, a large map and an adjacent report list. Street search, inventory/density/report layers, time and source filters, most-reported locations, bin history and photo-based missing-bin registration remain available. The low-noise More menu contains Add a bin, Review cases and About the project. Source attribution starts collapsed behind the map’s information control and remains available in bin details. A narrow viewport stacks the map above the report list; selecting a report brings its location into view.

A phone requires a **trusted HTTPS** origin reaching the server. The production hosting target is `https://whichbin.fyi`, with Cloudflare DNS pointing to Vercel and shared data in Supabase. See [Vercel deployment](docs/deployment-vercel.md) for configuration and operations. `http://localhost:3000` works only on the computer itself. A Cloudflare quick tunnel remains an optional local preview while the computer is running; its address can change when restarted. Set `APP_ORIGIN` to the exact public origin and use that origin when creating demo QR links. Verify Safari and Chrome on physical phones before presentation.

## Live projector demo

1. Configure Gemini and test the saved key/model.
2. Sign in at `/manage/demo`, choose the actual Toronto asset represented by the staged demo, and set the HTTPS app address reachable by the phone.
3. Create the isolated session. Open its presentation on the projector and its private QR scanner link on the phone.
4. Point the phone camera at the displayed photograph. One image is captured. If overflow is detected, the prefilled report page opens; confirm the selected demo asset and submit. The demo dashboard updates from the saved report.
5. Use **Retake photo** for another attempt. Empty or unrelated scenes must not create reports on their own.

The included public-domain photo is from **Hamburg, 2005**, visibly labeled as a reference image. The selected Toronto asset supplies demo context; stage GPS is ignored. Displaying the reference image does not itself create detections or reports. [Photo attribution](public/images/ATTRIBUTION.md).

## Verify and maintain

Dataset preparation and the optional free local annotation workspace are documented
in [training/README.md](training/README.md). The collection target is3,500 source
photos. Dataset files, credentials and review state stay in ignored `.data/`;
source annotations remain proposals until reviewed. The dataset tools do not
activate new models or change the public application's reporting behavior.

The production camera is at `/scan`; the former `/scan/test` URL redirects there.
It opens the rear camera unless `camera=off` is requested, waits two seconds after
playback is ready and analyzes exactly one photo. The clean camera screen shows
part names, destinations, arrows and Retake; model controls, upload controls,
per-item descriptions, response timings and export/footer UI are absent. Analysis
is transient; only a confirmed report uploads its image. The user-selected straw
policy maps plastic to Litter and paper to Paper · recycling, explicitly attributed
internally to `project:straw-sorting` rather than Toronto. Other item rules remain
unchanged. [Historical camera experiments](docs/local-vision-test.md) include
YOLO26 Nano, RF-DETR Nano and an experimental waste detector; those comparison
screens are not exposed by the production route. The first
detector completed30 epochs; a separate source-group classifier completed20.
The full usable collection is accounted for across the two tasks and their grouped
evaluation sets. The initial held-out detector results are weak, so these artifacts
remain experimental. See [training status](training/README.md) for actual counts,
label provenance and results. Follow the guide to prepare model files after a
fresh checkout; weights and datasets are deliberately excluded from Git.

```sh
npm run typecheck
npm test
npm run build
npm run db:backup
npm run data:cleanup
```

Tests use a separate temporary SQLite database. `npm run db:verify-cloud` performs real Postgres/PostGIS/Storage checks in an isolated demo scope and removes its records and photos afterward. Cloud backup creates a private logical JSON data export in `.data/`; it contains image metadata, while image objects stay only in Supabase. It is not a full SQL/Storage disaster-recovery backup. In SQLite fallback mode, backup creates a consistent SQLite snapshot. Keep `.data/`, `.env.local`, backups and private scanner/receipt links out of version control.

The earlier static prototype and sketches are preserved under `archive/initial-concept/`. Original architecture PDFs remain under `output/pdf/`.

Case review at `/manage/cases` opens without management setup. Visitors see public case status and active observations. Private notes, photos, ownership and the audit trail are omitted from anonymous detail responses. Administrative edits and evidence access remain protected; configured operators can use the optional management sign-in.

## Manual reporting and closing issues

The scanner's manual-report action opens an editable bin form. With location allowed, it suggests the nearest in-service bin and shows its distance. The location row focuses the street/City ID field, and selecting a different search result preserves that choice even if GPS returns later. The independent GPS suggestion names its bin, so its distance is never attributed to a different selection. Location failure leaves street search usable.

Select a dashboard map bin, then Details to see street, side, ward, inventory status, current issues and history. Report an issue starts the same form with that bin selected. Mark resolved opens an explicit inline confirmation for the displayed open cases. Resolution is a community update, retained in the audit history; it removes those cases from active highlights, report heatmaps and affected-bin/open-case counts. It does not delete accepted report history or prevent a new report opening a later episode. Withdraw my report retracts only the current session's own mistaken report; private receipt recovery remains available separately. Other people's observations and management permissions are unaffected.
