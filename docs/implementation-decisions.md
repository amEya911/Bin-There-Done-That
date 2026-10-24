# Implementation decisions

This checkout follows the three supplied architecture documents and the direct instructions in chat. Documents are source material; they do not independently authorize publishing, GitHub pushes, external messages or City submissions.

## Reconciled behavior

| Decision                                     | Implemented behavior                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal automatic reporting vs confirmation | The camera can automatically persist an overflow observation after two consistent results and a resolved physical bin. Manual/photo reporting uses an explicit submit. Neither path submits externally. |
| Device entry                                 | Phones default to scanner, computers to dashboard. Both have cross-navigation. Camera-off preview and a stop control support pausing hardware.                                                          |
| AR                                           | Image-aligned boxes, numbered component pins and arrow callouts over video/photos; moved or stale live results are discarded. Physical-opening localization remains a separate capability.              |
| Rules                                        | Reviewed Toronto public-space subset, versioned by review date. Cup body is separate from uncertain lid/straw. Unsupported material remains uncertain.                                                  |
| Counting                                     | Durable observations, distinct case episodes and unique affected bins are different counts. Retries and repeated frames do not inflate them.                                                            |
| Inventory                                    | Original dataset preserved. Stable UUID per source asset ID. Removed assets remain in source history but are excluded from matching.                                                                    |
| Missing bins                                 | Residents use a photo and fresh GPS within a designated polygon, without management setup. The server rejects any approved/pending bin within 15 m. Additions are labeled community records; photos are private. Operator inventory tools remain separate.                                                          |
| Demo                                         | Server-controlled, expiring demo scope. Secret scanner grant, selected bin, stage GPS ignored, real frames, no preloaded positive.                                                                      |
| Work and outcome                             | Private operator actions with audit trail; completion requires a note and image. Recheck is recorded separately as operator evidence, not independent proof.                                            |
| Handoff                                      | Downloadable packet and official link, clearly labeled prepared/not submitted.                                                                                                                          |
| Design                                       | Direct user request controls the orange/charcoal direction. The camera view was changed from green to orange/peach on request.                                                                          |
| Storage                                      | Supabase PostgreSQL/PostGIS and private Supabase Storage are the live persistence layer on the existing Free project. SQLite remains a test/rollback adapter.                             |
| Delivery                                     | Production app shared through the existing Nginx/Cloudflare Tunnel; managed Supabase data. No GitHub staging, commits or pushes.                                                                                                                                             |

## Data boundaries

Core `bins`, `areas`, `cases` and `reports` tables have typed relational/spatial projections, foreign keys and indexes, with a JSONB payload preserving existing domain fields. Generated columns make location, status, scope and case relationships directly queryable and enforceable. PostGIS geography uses WGS84 coordinates and metre distances; area containment includes boundary points. The immutable source and generated map artifact remain for provenance and initial map rendering; API reads and writes use Postgres.

`app_private` stores sessions, settings, scans, audit records, demo grants, idempotency keys, quotas and image metadata. RLS is enabled and browser roles have no direct table grants. The Next.js backend connects with strict TLS through the Supabase pooler and returns redacted public projections. This is a server-mediated authorization model, not browser-owned RLS identities. Mutations use serializable transactions, a shared advisory write lock and bounded retries. The current global write lock favors consistency at hackathon traffic levels; high-volume throughput needs measurement before claiming scale. Dashboard counts use one read-only repeatable-read snapshot.

Image bytes live in private Supabase Storage. Metadata and expiry live in `app_private.media`. The server checks ownership and expiry before returning bytes. No public Storage URL is returned. Selected analysis frames have ten-minute retention until accepted; accepted evidence defaults to seven days. Hourly cleanup depends on an active app process; an independently scheduled job would be needed if all app instances stop.

Public projections strip private notes, device session IDs, recovery hashes, evidence paths and operator ownership. Unmatched coordinates are rounded to 0.001 degrees. Exact registered bin coordinates are public inventory. A private receipt uses a secret whose hash is stored. Management passwords use salted scrypt. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Images are decoded with pixel/byte limits and re-encoded without EXIF.

## Operating assumptions

- The application server and its server-side credentials are trusted; protect `.env.local` and private data exports. A temporary tunnel still depends on this computer remaining online.
- The initial downtown rectangle is a configurable pilot boundary, not an official City designation.
- GPS thresholds (15 m accuracy, 25 m nearest candidate, no competitor within 50 m), 20-second observation pairing, scene hash and box-overlap thresholds require field calibration.
- Model certainty is qualitative and uncalibrated. No numeric fill percentage or correctness guarantee is shown.
- Public map badges refer to recorded observations in the selected time window; no report does not mean clean.
- An operator can misclassify a completion or recheck. The app records attribution and evidence; it does not infer causation or independent verification.
- No production-readiness, AI accuracy or projector success rate is claimed before physical testing.
