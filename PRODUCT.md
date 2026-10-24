# Bin There Done That

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Toronto residents using a phone to sort an item or identify an overflowing public bin. Desktop visitors explore bin locations and community reports. Residents can add a missing bin using a photo and fresh location inside a designated area, without management setup. Operators can review cases and manage inventory.

## Product Purpose

Connect camera-based waste sorting with location-based reporting and a Toronto bin map.

## Operating Context

Mobile entry opens the scanner; desktop entry opens the dashboard. The hackathon demonstration may point a phone at a projected bin photograph, using an isolated demo session rather than creating public incidents.

## Capabilities and Constraints

- The scanner is automatic: item scenes receive component-level disposal guidance; bin scenes are assessed for visible overflow. No mode selector, capture/upload strip, idle feedback strip, or manual item lookup is wanted.
- Ask for browser camera and location permission. Automatic camera reports select a physical bin only when GPS establishes an unambiguous match. Manual reports suggest the nearest registered bin, show its distance and retain editable street/City ID search, including when location is unavailable.
- Require two fresh, matching observations before saving an automatic overflow report. Preserve duplicate prevention, honest uncertainty, report receipts, and separation of reports and cases.
- Show Toronto inventory, report counts and heatmaps. Public missing-bin registration requires a photo and fresh, sufficiently accurate location inside a designated area. Reject a nearby existing or pending bin without an override.
- The production Next.js server uses Supabase PostgreSQL/PostGIS and private Supabase Storage on the Free plan, with a server-side Gemini connection. SQLite is retained for isolated tests and rollback. AI availability depends on the configured provider; UI work must not claim live recognition succeeded without a real test.
- Reports are saved by this project, not submitted to Toronto 311.
- Publish project code to GitHub only with explicit user authorization. The user authorized a push on 24 October 2026. Credentials, local databases, annotation accounts, downloaded training images and model binaries remain excluded from Git.

## Brand Commitments

The user-facing name is Bin There Done That. Orange is a small accent, not a page background. Dashboard, scanner and browser safe areas follow the system light/dark preference. The scanner uses a neutral viewing area and brand-only header navigation, with no provider billing card, persistent location controls or 311 footer line. The dashboard has no source-disclosure footer and no live-demo/setup menu links. Preserve its map-first layout and align navigation controls.

## Evidence on Hand

City of Toronto litter receptacle GeoJSON, existing app and API contracts, and the user's three scanner screenshots identifying the strips to remove. Dashboard data must remain real; do not fabricate incidents or activity.

## Camera fitting and case review refinement

The live video fills its rounded frame with a centered cover crop. Analysis frames and motion samples use the identical visible crop; resize/orientation changes invalidate stale observations. Feedback must not change camera dimensions. There is no in-camera power icon or provider-unavailable idle sentence. Leaving the scanner still releases the camera. Map attribution starts collapsed behind its information control. Public case review opens directly without configuration, exposing only already-public status/report fields; private evidence, notes, ownership and management actions retain their existing protections.

## Manual reporting and resolution

Camera manual reporting suggests the nearest registered bin with a distance and editable street/City ID search. Location failure must never block street search. Bin details show location, side, ward, inventory status, current issues and history, and offer the same report form with that bin selected. Community members can explicitly confirm that the displayed open cases are resolved. This clears active map/heatmap highlights and affected-bin/open-case counts without deleting historical observations. New reports after resolution open a new episode. Reporters can withdraw their own mistaken report on the details page; other people's reports remain. Community resolution is labeled as such and does not claim City verification.
