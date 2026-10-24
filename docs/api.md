# API contract

All JSON mutations use same-origin requests. The server owns an HttpOnly anonymous session. Management mutations additionally require a signed-in operator. Responses use `{ "error": "…" }` with a non-2xx status on failure. Keys, raw phone GPS, private notes, evidence and recovery hashes are not public.

Use `?scope=public` (default) or `?scope=demo:ID`. The server validates demo existence/expiry and requires a private writer grant for demo mutations. Changing a query parameter does not grant writer access.

| Method     | Endpoint                              | Behavior                                                                                         |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET        | `/api/status`                         | Connection flags and current role; no credentials                                                |
| POST       | `/api/settings`                       | Localhost initial setup; later requires management access                                        |
| POST       | `/api/settings/test`                  | Real generation/access check; management only                                                    |
| POST       | `/api/auth/login`, `/api/auth/logout` | Local management session                                                                         |
| GET        | `/api/rules`                          | Reviewed rule subset                                                                             |
| GET        | `/api/bins?q=…&limit=…`               | Search, inventory totals and permitted records                                                   |
| GET        | `/api/bins/nearby?lng=…&lat=…`        | Active approved candidates within 500 m                                                          |
| GET        | `/api/bins/:id`                       | Public-safe bin history                                                                          |
| POST       | `/api/bins/submit`                    | Resident photo + fresh GPS registration; designated area, hard 15 m duplicate block; idempotent      |
| POST       | `/api/bins`                           | Operator registration; area and duplicate checks                                                 |
| PATCH      | `/api/bins/:id`                       | Operator approval/rejection with review note                                                     |
| GET / POST | `/api/areas`                          | Read permitted areas / operator creates simple closed polygon                                    |
| POST       | `/api/scan`                           | Selected image → validated vision result, sourced guidance, short-lived scan ID                  |
| POST       | `/api/reports`                        | Transactional observation and case creation with idempotency                                     |
| GET        | `/api/reports?offset=0&limit=30`      | Paginated scoped accepted observations; `nextOffset`                                             |
| POST       | `/api/reports/:id/withdraw`           | Original session, recovery secret or operator                                                    |
| POST       | `/api/receipts/:id`                   | Original session, recovery secret or operator; private receipt                                   |
| GET        | `/api/dashboard?window=24h`           | Open counts, latest 200 open reports, accepted-history count and aggregate map points across the complete window; also `7d`, `all` |
| GET        | `/api/cases/:id`                      | Operator evidence, notes and timeline                                                            |
| POST       | `/api/cases/:id/actions`              | Review, ready, assign, associate, complete, recheck, reopen                                      |
| POST       | `/api/cases/:id/merge`                | Operator merges same-bin case after an explicit reason                                           |
| POST       | `/api/cases/:id/split`                | Operator separates a selected observation with a reason                                          |
| GET        | `/api/cases/:id/handoff`              | Prepared packet; not an external submission                                                      |
| GET        | `/api/media/:id`                      | Private, expiring sanitized image; operator or original reporter only                            |
| POST       | `/api/demo/sessions`                  | Presenter creates selected-bin demo and receives write secret once                               |
| GET        | `/api/demo/sessions/:id`              | Unlisted, expiring demo context, no write secret                                                 |
| POST       | `/api/demo/sessions/:id/join`         | Validate secret and grant this session demo writes                                               |

## Camera request

```json
{
  "image": "data:image/jpeg;base64,…",
  "capturedAt": "2026-10-22T18:00:00.000Z",
  "mode": "auto",
  "method": "camera"
}
```

Use mode `auto`, `bin` or `item`; method `camera` or `upload`. Scan timestamps describe the current analysis capture; they do not establish when an uploaded original was photographed. The response contains an ID, normalized x/y/width/height boxes, qualitative certainty, visible evidence and rule-backed guidance. Unrelated/uncertain results are valid and cannot auto-report.

## Report request

```json
{
  "binId": "stable-bin-uuid",
  "location": [-79.39, 43.65],
  "accuracy": 9,
  "locatedAt": "2026-10-22T18:00:00.000Z",
  "matchMethod": "selected",
  "scanIds": ["first-scan-id", "second-scan-id"],
  "idempotencyKey": "one-episode-unique-key",
  "source": "camera",
  "issue": "overflowing",
  "note": ""
}
```

Camera source requires two server-held, consistent results from the same session/scope. `auto` matching also requires a fresh accurate location and unambiguous candidate. `selected` records an explicit user association. Demo identity comes from the server session, never stage GPS. Manual reports may be unmatched with an explicit location. Upload fallback may attach an `image` directly without AI; original capture time remains unknown unless explicitly supplied.

A successful response contains `report`, `duplicate` and (on first creation only) a private `recovery` secret. Show Saved only after success. On retries, use the same idempotency key. Never display a pending or failed request as reported.

`POST /api/connection/check` retries real Gemini generation with the configured server key. It is rate limited, returns no credential, and updates the scanner’s public-safe availability status. HTTP 402 pauses scanning with an explicit prepaid-credit message.

Resident bin submissions require `image` (JPEG/PNG/WebP data URL), `location` ([longitude, latitude]), `accuracy` (≤25 m), `locatedAt` (≤2 minutes old), and `idempotencyKey`. A committed addition returns `{bin, duplicate:false}` with 201; a matching retry returns the original with 200. Missing evidence, stale/inaccurate GPS, inactive/outside areas, or any non-rejected bin within 15 m prevent creation. Photos are sanitized and privately retained. This registration does not claim automated verification of the photographed object.

`GET /api/cases/:id` returns a redacted public projection to anonymous visitors (`readOnly: true`), including only active public reports. It omits ownership, audit actions, private notes, photos, precise unmatched GPS and session/recovery fields. Cases with no active reports are absent from the anonymous view. Administrators retain the existing full response. Action, correction, handoff and evidence endpoints keep their authorization requirements.

### Manual reporting and community resolution

- `GET /api/bins/nearby?lng=...&lat=...&nearest=true` returns the five nearest approved, in-service bins, sorted by distance in metres. Unlike the automatic matcher, this explicit suggestion mode has no 500 m cutoff; the UI must show distance and allow correction. Without `nearest=true`, the existing 500 m response is retained. Both coordinates are required.
- `GET /api/bins/:id` includes the requesting session's `ownReportIds` for personal withdrawal controls. Other sessions do not receive this ownership subset. Report fields and audit evidence remain redacted.
- `POST /api/bins/:id/resolve` accepts `{confirmed:true, caseIds:[...]}`. It atomically checks scope, bin association and active reports, then marks only the named open cases `resolved` with clear condition and a private community audit action. A repeated request is harmless. New cases created after the displayed snapshot are not closed. This rate-limited community observation does not grant management permissions or claim City verification. Demo writes still require their existing scope grant.
- `PublicReport.caseState` identifies resolved history. Summary `totalReports` counts only reports on open cases in the selected window; `historicalReports` separately retains accepted history. `reports` is the open feed. `activeCases`, `affectedBins`, `binCounts` and `mapPoints` also exclude closed cases (`work_complete`, `rechecked`, `resolved`). A subsequent observation starts a new episode.
- The existing owner/recovery/admin-protected `POST /api/reports/:id/withdraw` remains the way to retract a mistaken observation. The details UI exposes it only for the current reporter's records.
