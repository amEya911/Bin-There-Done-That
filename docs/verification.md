# Verification record

## Current cloud verification — 24 October 2026

This section supersedes the earlier SQLite infrastructure notes below; those remain as a chronological record of previous work.

- Existing Supabase project `lhltzocrcndqrpxxsejk` remains on Free/NANO. PostgreSQL reports about 31 MB for the whole database after import. No plan, payment or paid-addon changes were made.
- Strict TLS connection verified through the Supabase pooler using its official CA. PostGIS nearest-distance, boundary-inclusive containment and actual GiST-index query plans passed.
- Imported all 10,457 City bins (9,822 Existing / 635 Temporarily Removed), the existing report/case, designated area, private application records, sessions, request keys and quotas. A final SQLite backup and stopped-server delta copy preceded activation. `DATA_BACKEND=postgres` is active in the running production app.
- No unexpired retained local image remained to copy. Real sanitized-image upload, protected download and removal passed against private Supabase Storage, with no local image file created. Retention metadata and bucket privacy were checked.
- Two concurrent reporters created two observations and one case, visible to an independent anonymous reader. Resolving cleared all open counters/map points and retained two historical observations. Recurrence opened a new case; a stale resolution could not close it. Unauthorized withdrawal failed; owner withdrawal passed.
- Concurrent missing-bin additions yielded one success and one 409 conflict. The accepted bin was visible to a different visitor and found through native PostGIS nearby lookup.
- These flows passed both by invoking the API handlers and through the actual public HTTPS Cloudflare/Nginx/production app stack. All synthetic reports, bins, areas, sessions and test photos used disposable demo scopes and were removed. No fake public incident was created.
- RLS and absent anonymous table grants were verified. Supabase advisors identified an existing exposed internal SECURITY DEFINER helper and unindexed foreign keys; its browser execute grants were revoked and the missing relationship indexes were added. Rechecked advisor warning/error filters showed no items. Informational deny-by-default RLS/no-policy and initial low-use index messages are expected in this server-mediated design.
- TypeScript, production build and all 34 isolated regression tests passed. The regression suite includes the open-count/history distinction. The full production path returned 200 JSON locally, through Nginx and through the current public tunnel.
- The existing resolved report is retained: the real public dashboard now returns zero open reports, zero open cases, zero affected bins and one historical report. iPhone root routing still redirects to the scanner.
- Both SQL versions are recorded as applied in Supabase migration history. The guarded cutover marker is present. A cloud logical data export completed, public build assets contained no server credentials, and final checks found no leftover verification bins, sessions or Storage objects.
- No GitHub staging, commits or pushes occurred. The application server remains on this computer; only data/image storage is managed by Supabase. No successful AI inference or changed Gemini billing status is claimed by this database migration.

See [cloud operations](cloud-storage.md) for the active configuration, retention, migration guard and hosting limits.

Date: October 22, 2026.

## October 23 interface redesign

The visible brand is now **Bin There Done That**. The dashboard uses horizontal navigation, four separate overview counts, a large map with adjacent reports, street search, map/time/source filters, most-reported locations, expandable provenance and a missing-bin link. The former promotional panels, utility ticker and vertical navigation are removed. At 390 px the map stacks above reports without horizontal overflow.

The scanner always requests automatic scene selection. The mode selector, capture/upload controls, idle feedback block and manual item lookup are removed. Camera-off, manual issue reporting, result overlays, receipts and physical-bin confirmation remain. Location watching starts with the camera and applies the existing conservative matching rules. Camera-off previews were used for browser checks; actual GPS and camera inference were not tested.

The production build, TypeScript check and 23 isolated tests passed. Browser checks covered real street search and bin selection, map/time filters, operator navigation, source disclosure, camera-off scanner, manual-report form, keyboard dismissal and focus restoration for the location dialog. Three fixture reports in a separate temporary database and demo scope display three reports, one case and one affected bin. No test report was added to the public database.

The production server runs behind the existing Nginx proxy and temporary Cloudflare Tunnel. The public root redirects an iPhone user agent to `/scan`. This is temporary access to the local machine, not a durable hosted deployment. Gemini still reports a provider billing failure; no successful real camera recognition or physical AR tracking is claimed.

Current interface captures are under `.impeccable/review/`. No Git staging, commit or push was performed.

## Automated checks

- TypeScript validation passes.
- Optimized Next.js production build passes.
- `npm test`: 23 tests pass, using temporary isolated SQLite storage.
- Dependency audit: zero reported vulnerabilities at installation/verification time.

Tests cover the import counts and stable IDs; polygon boundary and self-intersection handling; ambiguous GPS matching; management authorization; missing-key behavior; salted password setup; manual approval and duplicate review; three-report/one-case/one-bin counting; request idempotency; reporter recovery and withdrawal; two-frame overflow requirements; negative/stale/replayed/shifted/foreign-scope evidence; continued-scan suppression; demo writer grants and scope isolation; uncertain model output and unsupported materials; public projection privacy; operator authorization; image sanitization and no-key upload fallback; completion/recheck ordering; recurrence as a new episode; case merge/split; operator association of unmatched reports; and safe handling of provider billing failures, including pausing scans without exposing credentials.

The report test sends Promise-all requests through real NextRequest/route handlers in a single process. Multi-process load and production abuse resistance have not been measured.

## Browser verification

The app was inspected in the in-app browser at desktop and phone-sized viewports. Checked:

- Dashboard uses the actual Toronto inventory and starts with zero fabricated reports.
- MapLibre worker loads from local version-matched assets; real map and bin-density layer render.
- Street search returns actual source records; selecting a bin shows its location and report history card.
- Camera-off scanner layout renders at 390 × 844 with readable controls; manual paper-cup lookup returns the reviewed Toronto instruction.
- Camera palette changed to orange/peach and warm charcoal following user feedback.
- A separate production server and temporary database were used for browser writes, keeping test records out of the main preview.
- Operator sign-in works; out-of-area bin registration is rejected; a valid approved manual bin saves and becomes searchable.
- With camera off, a manually selected community bin accepts a report and shows success only after save.
- The isolated test dashboard updates to 9,823 active locations, one accepted report, one case and one affected bin.
- The report reaches the private operator queue; assignment saves and appears in the action timeline.
- No browser console errors were observed during the operator flow.

## Remaining external/physical validation

A Gemini credential was supplied and saved only in ignored server-side local storage. Google accepted model discovery and confirmed `gemini-3.8-flash` access. Actual image analysis and a minimal text-generation check were rejected with HTTP 402: the project’s prepayment credits are depleted. The scanner now shows the billing issue, prevents repeated blocked scans and offers an explicit inference-based connection retry. Recognition accuracy, output localization, successful scan latency and model cost remain unmeasured. No simulated model response is used as a substitute.

The user asked to switch the camera off; subsequent UI checks kept it off. Physical iPhone Safari and Android Chrome camera permissions, rear-camera selection, orientation/motion, GPS ambiguity, lighting/glare and phone-to-projector recognition still require testing on actual devices after connecting Gemini and trusted HTTPS.

The intended projector rehearsal remains ten real attempts, including empty/unrelated scenes and disconnect/reconnect. No success rate or stage readiness is claimed yet.

## Camera and AR review improvements

- A 390 × 844 browser inspection confirmed the orange camera-off scanner and manual lookup. The camera stayed off.
- The annotation renderer was visually checked with a clearly labeled illustrated cup and supplied component boxes. Numbered arrows, bounded labels, and the uncertain lid/straw treatment fit a phone viewport. This is layout verification, not model output or physical tracking validation.
- An isolated production server and separate `/tmp/trashme-review-isolated` database confirmed three reports/one case/one affected bin, the most-reported-location card, selecting its actual asset, the report heatmap, and the phone dashboard layout. No browser console errors were reported. These fixture reports did not enter the main database.
- New tests cover camera/photo letterboxing, malformed dimensions, stale or moved live results, intervening movement, crowded labels, quality-defect suppression of sorting advice, absent overflow evidence, future timestamps, physical-bin requirements, and scope isolation during idempotent retries.
- Pause, manual reporting, mode/bin changes, tab hiding, and camera-off invalidate pending analysis results. Hardware/in-flight camera behavior still needs a physical rehearsal; it is not established by layout checks.
- Local public status still reports `billing_required`. No provider inference was attempted or simulated during this review.

Saved browser evidence is in `output/qa/`: `ar-layout-mobile.jpg` (explicit fixture), `dashboard-reports-desktop.jpg`, and `dashboard-reports-mobile.jpg` (isolated test records). See the [detailed review](hackathon-review-and-ar.md).

Cloud Supabase/PostGIS, managed storage/identity and multi-instance deployment remain the next infrastructure phase. The working local persistence is SQLite; a persistent disk is required.

No GitHub commit/push, City submission, email or external deployment was performed.

## System theme, scanner cleanup and resident registration — 2026-10-23

26 isolated behavior tests pass. The additional tests cover anonymous photo-based registration without management login, image sanitization and private evidence access, idempotent retries, stale/imprecise GPS, designated-area containment, concurrent collision rejection, pending-bin collisions and refusal of duplicate explanations as an override. No synthetic bins or incidents were added to public storage. Production build and TypeScript checks pass.

Browser checks cover desktop (1440 px), phone (390 px) and the current 1280 px viewport. Light preference was emulated through Chrome DevTools; dark used the current system preference in the in-app browser. The map now observes its container size, preserves its viewport when the preferred theme changes, and uses the matching light/dark basemap. Camera hardware stayed off: this verifies the camera-off layout, manual dialog, navigation and photo picker, not live AI inference or physical-phone GPS. Safe-area CSS and browser theme metadata were checked; Safari browser chrome still needs physical-device validation.

The resident photo page was checked with a selected photo and denied/unavailable location. It offers location retry and blocks saving without location. GPS matching, hard 15 m conflict checks, area assignment and saves are validated by isolated server tests. Screenshots and the finish-review record are under `.impeccable/review/`.

## Camera fitting, collapsed credits and direct case review

All 28 isolated tests pass, including centered camera cover-crop geometry and public case-detail privacy. The production build and TypeScript checks pass. The public HTTPS dashboard, camera-off scanner and case-review page return HTTP 200 without the removed setup gate or idle provider-unavailable sentence.

Camera rendering uses a centered cover crop; capture and motion sampling use the same source region. Feedback stays below a stable frame. Static poster fixtures verify portrait and landscape fitting, while camera-off screenshots verify the simplified controls in both system themes. These are layout and mathematical checks, not evidence of successful live inference or physical iPhone camera behavior.

Map credits start collapsed and expand through the information control. Case review opens directly with public information; administrative actions, ownership, private notes and evidence remain protected. Empty and populated views were inspected at phone and desktop widths. Populated cases were explicitly labeled fixtures in a separate temporary SQLite database; no synthetic records entered public storage. Temporary QA servers and databases were removed.

The fresh Impeccable finish review returned `ship` for this refinement, with no material fixes. Evidence is saved under `.impeccable/review/camera-fit/`. No Git staging, commit or push was performed. Physical-phone camera/GPS and successful provider inference remain external validation items.

## Manual reporting, nearest selection and community resolution

31 isolated tests pass. New coverage verifies sorted nearest suggestions beyond the automatic radius, removed-bin exclusion, required coordinates, editable street-address search, per-session withdrawal controls, atomic scoped resolution, idempotent repetition, partial closure with remaining issues, retained history, recurrence, stale confirmation against a newer episode and withdrawal after resolution. The production build and TypeScript check pass.

Browser checks used a separate temporary SQLite server. Camera-off manual street search saved a report; map selection led to details; its preselected form saved a second issue; explicit confirmation resolved the displayed cases; ownership-specific withdrawal worked. The dashboard retained a resolved report while showing zero open cases and affected bins, with no active incident highlights. No synthetic report entered public storage. Temporary QA storage and server were removed. Both system themes were inspected at390px and1440px, with a1280px normal viewport. Saved captures are under `.impeccable/review/manual-reporting/`.

A temporary Chrome DevTools location verified automatic nearest selection. It confused the user while visible; it was explicitly cleared and the subsequent actual browser location returned a different nearest bin24m away. Location emulation was verified as No override. Physical-phone GPS accuracy remains unmeasured.

The finish reviewer requested one correction: a GPS distance retained after choosing another bin could be misattributed. The final message explicitly names the independent GPS-nearest bin, and the existing user-edit guard preserves selection during a pending location lookup. The reviewer scored this source/copy fix resolved and returned ship at that scope. The final changed-bin rendering was not recaptured because the user stopped desktop screen capture. Chrome browser-only control was unavailable; no further native desktop capture/control was used. The earlier layout captures remain evidence for the unchanged form structure.

No Git staging, commit or push was performed. Live model inference and physical phone camera behavior were not tested in this pass.

## Transient tunnel response handling

The user supplied a dashboard screenshot with a raw JSON parser error. The Cloudflare log records a QUIC timeout followed by reconnection around the screenshot time. Local app, Nginx and public API checks all returned200 application/json afterward; one accepted resolved report remained, with zero open cases and affected bins. The evidence supports a transient connection interruption; the exact failed HTML response was not retained.

The shared API client now requests JSON explicitly, rejects HTML/truncated responses with readable connection messages, and retries a failing GET once. It respects cancellation and preserves server validation errors. Writes are never automatically resubmitted.34 tests pass, including transient recovery, persistent non-JSON/malformed response handling, no write retry, cancellation and preserved validation errors. Production build/TypeScript pass. After restart, public API JSON and the served browser bundle containing the new handling were verified over the existing Cloudflare link. No browser/desktop capture was used, and report data was not modified.