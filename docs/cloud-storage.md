# Shared database and image storage

The production app uses the existing **Bin There Done That** Supabase project (`lhltzocrcndqrpxxsejk`) on **Free**, with PostgreSQL, PostGIS and private Storage. No upgrade, paid compute, payment method or paid add-on was added.

## What lives where

| Data | Location | Access |
| --- | --- | --- |
| Toronto/community bins, designated polygons, cases, reports | PostgreSQL core tables | Same-origin backend returns public projections |
| Sessions, private notes, audits, demo grants, request keys and quotas | Private database schema / private domain fields | Backend only |
| Retained JPEG image bytes | Private `bin-evidence` Supabase Storage bucket | Backend checks reporter/operator access and expiry |
| Image object paths and expiry | `app_private.media` | Backend only |
| Database password, Storage server secret, active Gemini key | Ignored `.env.local`, mode 0600 | Application server only |
| Original City GeoJSON and compact map layer | Source file / public map artifact | Public inventory, unchanged |
| Pre-cutover local database | Ignored `.data/` rollback snapshots | Local archive; no longer the live source |

People opening the same public link see the same reports. They do not need a Supabase account. Anonymous session cookies identify their own receipts/withdrawal rights; reports are not tied only to one browser's local storage. Public visibility does not expose notes, recovery hashes, private images or device-session identifiers.

## Native spatial queries

`bins.location` is WGS84 PostGIS geography with a GiST index. Nearby matching uses metre distances and spatial radius checks. Manual nearest suggestions can search beyond the automatic-matching radius, but remain editable. `areas.boundary` is a polygon geometry; `ST_Covers` includes its boundary. The server atomically rejects another non-rejected physical bin within 15 metres when adding a missing bin.

## Reports and counters

An observation is a **report**. Related observations form a **case**. Multiple cases/reports can relate to one physical **bin**. Serializable transactions and request keys protect mutations and retries; a shared database advisory write lock currently serializes mutations for consistency.

The dashboard reads its counters in one read-only repeatable-read snapshot:

- `totalReports` / **Open reports**: active observations belonging to open cases in the selected time window.
- `activeCases`: distinct open cases represented by those observations.
- `affectedBins`: distinct registered bins with those open observations.
- `historicalReports`: accepted observations in the window, including resolved history; withdrawn observations are excluded.

Resolving a case clears its open report feed/map markers and counters. It preserves history in bin details. A later issue opens a new episode. Withdrawal retracts only a report the caller owns or can recover with its private receipt.

## Image lifecycle

Only selected, sanitized still frames are sent for analysis. Continuous video stays on the device. JPEG re-encoding strips EXIF and enforces pixel/byte limits.

- Unreported analysis evidence: ten minutes.
- Accepted report, community-bin and follow-up evidence: seven days by default (`EVIDENCE_RETENTION_DAYS`).
- The backend refuses an expired image immediately. On Vercel, an authenticated daily cron removes expired Storage objects in bounded batches. Persistent local servers also run hourly maintenance. `npm run data:cleanup` performs cleanup manually. Physical removal requires one of these cleanup runs.
- The private bucket allows JPEG objects up to 8 MB. No public image URLs or local runtime image files are created in Postgres mode.

No previously retained local image was still eligible for migration at cutover. The actual Storage upload, protected download and removal paths were verified using a disposable test image in a separate demo scope.

## Connection and operations

Use Node 24 and the checked-in lockfile. Copy `.env.example` to `.env.local` only on a fresh checkout; never overwrite the configured secret file. The active app sets `DATA_BACKEND=postgres`. Set Supabase URL, server secret and the transaction-pooler database fields. The application pool is capped at three connections. TLS verifies the Supabase server using the supplied public CA certificate. Nothing uses `NEXT_PUBLIC_` credentials.

The SQL migrations in `supabase/migrations/` create the schema, PostGIS indexes, private bucket, RLS, permissions and internal helper restrictions. Both applied versions are recorded in Supabase’s migration history as well as the application checkpoint table. Direct `anon`/`authenticated` access is revoked deliberately; RLS without browser policies is a deny-by-default boundary, because this app uses its server's authorization checks. Advisor information about RLS without policies is expected. Low initial usage can also produce unused-index information; the spatial/expiry/relationship indexes are retained for their actual query paths.

```sh
npm run typecheck
npm test
npm run build
npm run db:verify-cloud
npm run data:cleanup
npm run db:backup
```

`db:verify-cloud` uses a temporary `demo:` scope, real independent anonymous sessions, concurrent reports and bin additions. It removes its own rows and Storage objects. It never creates fake public incidents.

Cloud backup writes a private logical JSON data export to ignored `.data/`. It includes domain data, private records and image metadata. It is not a full SQL restore archive or a backup of Storage objects; images remain only in Supabase as requested. Protect exports because they contain private application data.

## Completed migration and rollback boundary

The original SQLite database was backed up before migration. Toronto records and existing application records were imported, preserving IDs, cases, sessions, report request keys and quotas. The old app was stopped for the final copy; `sqlite-cutover` was recorded before activating Postgres. The import script refuses to overwrite live cloud data after that marker exists.

Do not run an old SQLite copy alongside the active cloud app or switch back casually: reports created after cutover exist in Postgres. A rollback must reconcile those later cloud writes first. The preserved SQLite files are pre-cutover archives only.

## Hosting boundary

The database and private image storage are managed by Supabase Free. The application is configured for Vercel Hobby with the custom domain `whichbin.fyi` managed by Cloudflare DNS. This hosting does not depend on the laptop or a quick tunnel. Deployment status and domain verification must succeed before the custom address is usable. See [deployment operations](deployment-vercel.md). This hosting move does not change Gemini billing or establish field-tested AI accuracy.
