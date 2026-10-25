import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  get,
  list,
  put,
  remove,
  uid,
  hash,
  secret,
  config,
  cloudEnabled,
  withRequestCache,
  consume,
  cleanup,
  transaction,
  equal,
  passwordDigest,
} from "@/lib/db";
import {
  admin,
  assert,
  attachCookie,
  checkOrigin,
  ensureSession,
  HttpError,
  localSetup,
  newLogin,
  scopeFor,
  validPassword,
} from "@/lib/auth";
import {
  bins,
  binById,
  nearby,
  summary,
  createReport,
  registerBin,
  createCommunityBin,
  publicReport,
  publicCase,
} from "@/lib/service";
import type { BinEvidence } from "@/lib/service";
import { inventory } from "@/lib/inventory";
import { query, readSnapshot } from "@/lib/postgres-store";
import { saveMedia, removeMedia, readMedia, retainMedia } from "@/lib/media";
import { analyze, sanitizeImage, verifyConnection } from "@/lib/vision";
import { providerHealth } from "@/lib/provider-health";
import { guidance, ITEM_OPTIONS } from "@/lib/rules";
import { contains, validPolygon } from "@/lib/geo";
import { isCaseOpen } from "@/lib/cases";
import type { Area, Bin, Case, Demo, Report, Scan } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Leave room below the hosting platform's request limit for JSON overhead.
const MAX_BODY_BYTES = 4_000_000;
const point = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const reportSchema = z.object({
  binId: z.string().nullable().optional(),
  location: point,
  accuracy: z.number().min(0).max(100000).nullable().optional(),
  locatedAt: z.string().datetime().optional(),
  matchMethod: z.enum(["auto", "selected", "pin", "demo"]),
  scanIds: z.array(z.string()).max(2).default([]),
  idempotencyKey: z.string().min(8).max(150),
  source: z.enum(["camera", "manual", "upload"]),
  issue: z.enum(["overflowing", "litter", "damaged", "dumping"]),
  note: z.string().max(1000).default(""),
  image: z.string().optional(),
  capturedAt: z.string().datetime().nullable().optional(),
});
async function body(req: NextRequest) {
  const length = Number(req.headers.get("content-length") || 0);
  assert(length <= MAX_BODY_BYTES, 413, "This request is too large.");
  const reader = req.body?.getReader();
  assert(reader, 400, "Request body required.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "This request is too large.");
    }
    chunks.push(part.value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Send valid JSON.");
  }
}
async function handler(req: NextRequest) {
  let token: string | null = null;
  try {
    if (req.method !== "GET") checkOrigin(req);
    const auth = await ensureSession(req);
    token = auth.token;
    const s = auth.session;
    const parts = req.nextUrl.pathname
        .replace(/^\/api\/?/, "")
        .split("/")
        .filter(Boolean),
      route = parts.join("/"),
      method = req.method;
    const json = (data: unknown, status = 200) =>
      attachCookie(
        NextResponse.json(data, {
          status,
          headers: { "Cache-Control": "no-store" },
        }),
        token,
        req,
      );
    if (route === "status" && method === "GET") {
      const c = await config();
      return json({
        aiConnected: !!c.apiKey,
        aiError:
          (await providerHealth())?.state !== "ready"
            ? (await providerHealth())?.message || null
            : null,
        aiState: (await providerHealth())?.state || "unverified",
        model: c.model,
        adminConfigured: !!c.passwordHash,
        isAdmin: s.admin,
        storage: cloudEnabled()
          ? "Supabase PostgreSQL + private Storage"
          : "SQLite · this computer",
        rules: ITEM_OPTIONS,
        sessionId: s.id.slice(0, 8),
      });
    }
    if (route === "settings" && method === "POST") {
      localSetup(req);
      const c = await config();
      if (c.passwordHash) admin(s);
      const input = z
        .object({
          apiKey: z.string().max(300).optional(),
          model: z
            .string()
            .regex(/^[a-zA-Z0-9.\-_]+$/)
            .default("gemini-3.8-flash"),
          password: z.string().max(150).optional(),
        })
        .parse(await body(req));
      if (!c.passwordHash || input.password)
        assert(
          input.password && input.password.length >= 12,
          400,
          "Choose a management password with at least 12 characters.",
        );
      const previous = await get<{
        id: string;
        apiKey?: string;
        passwordHash?: string;
      }>("setting", "connection");
      await put("setting", {
        id: "connection",
        apiKey: input.apiKey || previous?.apiKey || "",
        model: input.model,
        passwordHash: input.password
          ? passwordDigest(input.password)
          : previous?.passwordHash || c.passwordHash,
      });
      token = await newLogin(s);
      return json({ saved: true, aiConnected: !!(await config()).apiKey });
    }
    if (
      (route === "settings/test" || route === "connection/check") &&
      method === "POST"
    ) {
      if (route === "settings/test") admin(s);
      await consume(`connection:${s.id}:${Math.floor(Date.now() / 60000)}`, 2);
      await consume(
        `global:${new Date().toISOString().slice(0, 10)}`,
        Number(process.env.DAILY_SCAN_LIMIT || 500),
      );
      return json(await verifyConnection());
    }
    if (route === "auth/login" && method === "POST") {
      const p = z
        .object({ password: z.string().max(150) })
        .parse(await body(req));
      await consume(
        `login:${req.headers.get("x-forwarded-for") || "local"}:${Math.floor(Date.now() / 60000)}`,
        8,
      );
      assert(
        (await config()).passwordHash && (await validPassword(p.password)),
        401,
        "The management password did not match.",
      );
      token = await newLogin(s);
      return json({ ok: true });
    }
    if (route === "auth/logout" && method === "POST") {
      await put("session", { ...s, admin: false, demoScopes: [] });
      return json({ ok: true });
    }
    if (route === "rules" && method === "GET") return json(ITEM_OPTIONS);
    const scope = await scopeFor(req, s, method !== "GET");
    if (route === "bins" && method === "GET") {
      const search = req.nextUrl.searchParams.get("q")?.toLowerCase() || "";
      const pending = req.nextUrl.searchParams.get("pending") === "true";
      if (pending) admin(s);
      const limit = Math.min(
        200,
        Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 50)),
      );
      if (cloudEnabled()) {
        const pattern = `%${search}%`;
        const rows = await query(
          "select data from public.bins where (source='toronto' or scope=$1) and ($2::boolean or approval='approved') and concat_ws(' ',data->>'name',data->>'address',data->>'sourceId',data->>'ward') ilike $3 order by name,id limit $4",
          [scope, pending, pattern, limit],
        );
        const [counts] = await query(
          "select count(*) filter(where concat_ws(' ',data->>'name',data->>'address',data->>'sourceId',data->>'ward') ilike $3)::int total,count(*) filter(where status='Existing')::int active,count(*) filter(where status<>'Existing')::int removed,count(*) filter(where source='manual')::int manual from public.bins where (source='toronto' or scope=$1) and ($2::boolean or approval='approved')",
          [scope, pending, pattern],
        );
        return json({ bins: rows.map((r) => r.data), ...counts });
      }
      const all = await bins(scope, pending);
      const filtered = all.filter((b) =>
        `${b.name} ${b.address} ${b.sourceId} ${b.ward}`
          .toLowerCase()
          .includes(search),
      );
      return json({
        bins: filtered.slice(0, limit),
        total: filtered.length,
        active: all.filter(
          (b) => b.status === "Existing" && b.approval === "approved",
        ).length,
        removed: all.filter((b) => b.status !== "Existing").length,
        manual: all.filter(
          (b) => b.source === "manual" && b.approval === "approved",
        ).length,
      });
    }
    if (route === "bins/nearby" && method === "GET") {
      assert(
        req.nextUrl.searchParams.has("lng") &&
          req.nextUrl.searchParams.has("lat"),
        400,
        "Location coordinates are required.",
      );
      const lng = Number(req.nextUrl.searchParams.get("lng")),
        lat = Number(req.nextUrl.searchParams.get("lat"));
      point.parse([lng, lat]);
      const nearest = req.nextUrl.searchParams.get("nearest") === "true";
      return json({
        bins: (await nearby([lng, lat], scope, nearest ? Infinity : 500)).slice(
          0,
          nearest ? 5 : 15,
        ),
      });
    }
    if (route === "bins/submit" && method === "POST") {
      await consume(
        `bin-submit:${s.id}:${new Date().toISOString().slice(0, 10)}`,
        30,
      );
      const input = z
        .object({
          image: z.string().min(1),
          location: point,
          accuracy: z.number().min(0).max(100000),
          locatedAt: z.string().datetime(),
          idempotencyKey: z.string().min(8).max(150),
        })
        .parse(await body(req));
      const image = await sanitizeImage(input.image);
      const mediaId = uid();
      await saveMedia(mediaId, image.buffer);
      try {
        const result = await createCommunityBin(
          { ...input, mediaId, frameHash: image.frameHash },
          s,
          scope,
        );
        if (result.duplicate) await removeMedia(mediaId);
        return json(result, result.duplicate ? 200 : 201);
      } catch (error) {
        await removeMedia(mediaId);
        throw error;
      }
    }
    if (parts[0] === "bins" && parts.length === 2 && method === "GET") {
      const bin = await binById(parts[1], scope);
      assert(
        bin && (bin.approval === "approved" || s.admin),
        404,
        "Bin not found.",
      );
      return json({
        bin,
        reports: await Promise.all(
          (await list<Report>("report", scope))
            .filter((r) => r.binId === bin.id && r.status === "active")
            .map(publicReport),
        ),
        cases: await Promise.all(
          (await list<Case>("case", scope))
            .filter((c) => c.binId === bin.id)
            .map(publicCase),
        ),
        ownReportIds: (await list<Report>("report", scope))
          .filter(
            (r) =>
              r.binId === bin.id &&
              r.status === "active" &&
              r.sessionId === s.id,
          )
          .map((r) => r.id),
      });
    }
    if (
      parts[0] === "bins" &&
      parts.length === 3 &&
      parts[2] === "resolve" &&
      method === "POST"
    ) {
      const input = z
        .object({
          confirmed: z.literal(true),
          caseIds: z.array(z.string().min(1)).min(1).max(50),
        })
        .parse(await body(req));
      await consume(`resolve:${s.id}:${Math.floor(Date.now() / 3600000)}`, 40);
      return json(
        await transaction(async () => {
          const bin = await binById(parts[1], scope);
          assert(bin && bin.approval === "approved", 404, "Bin not found.");
          const cases = await Promise.all(
            [...new Set(input.caseIds)].map(async (id) => {
              const c = await get<Case>("case", id);
              assert(
                c && c.scope === scope && c.binId === bin.id,
                404,
                "Case not found for this bin.",
              );
              assert(
                (await list<Report>("report", scope)).some(
                  (r) => r.caseId === id && r.status === "active",
                ),
                409,
                "This case no longer has an active report. Refresh the bin details.",
              );
              return c;
            }),
          );
          const now = new Date().toISOString();
          for (const c of cases.filter((c) => isCaseOpen(c.state))) {
            c.state = "resolved";
            c.condition = "clear";
            c.updatedAt = now;
            c.actions.push({
              id: uid(),
              type: "community_resolved",
              at: now,
              actor: "Community observer",
              note: "A community member checked the bin and marked the reported issue resolved.",
            });
            await put("case", c);
          }
          return { binId: bin.id, resolvedCaseIds: cases.map((c) => c.id) };
        }),
      );
    }
    if (route === "bins" && method === "POST") {
      admin(s);
      const input = z
        .object({
          name: z.string().min(3).max(120),
          address: z.string().min(3).max(160),
          lng: z.number().min(-180).max(180),
          lat: z.number().min(-90).max(90),
          areaId: z.string(),
          status: z.enum(["Existing", "Temporarily Removed"]),
          approval: z.enum(["approved", "pending", "rejected"]),
          note: z.string().max(1000).optional(),
          duplicateExplanation: z.string().max(500).optional(),
        })
        .parse(await body(req));
      return json(await registerBin(input, scope), 201);
    }
    if (parts[0] === "bins" && parts.length === 2 && method === "PATCH") {
      admin(s);
      const b = await get<Bin>("bin", parts[1]);
      assert(
        b && (await list<Bin>("bin", scope)).some((x) => x.id === b.id),
        404,
        "Community bin not found.",
      );
      const change = z
        .object({
          approval: z.enum(["approved", "pending", "rejected"]),
          note: z.string().min(3).max(1000),
        })
        .parse(await body(req));
      await put("bin", { ...b, ...change }, scope);
      await put("audit", {
        id: uid(),
        type: "bin_reviewed",
        binId: b.id,
        at: new Date().toISOString(),
        note: change.note,
        decision: change.approval,
        scope,
      });
      return json({ ok: true });
    }
    if (route === "areas" && method === "GET")
      return json(await list<Area>("area", scope));
    if (route === "areas" && method === "POST") {
      admin(s);
      const input = z
        .object({
          name: z.string().min(3).max(100),
          polygon: z.array(point).min(4).max(200),
        })
        .parse(await body(req));
      assert(
        validPolygon(input.polygon),
        400,
        "Use a closed, simple polygon with at least three distinct corners.",
      );
      const a: Area = {
        ...input,
        id: uid(),
        scope,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await put("area", a);
      return json(a, 201);
    }
    if (route === "dashboard" && method === "GET") {
      const window = z
        .enum(["24h", "7d", "all"])
        .parse(req.nextUrl.searchParams.get("window") || "24h");
      if (cloudEnabled()) {
        return await readSnapshot(async () => {
          const [counts] = await query(
            "select count(*) filter(where source='toronto')::int total,count(*) filter(where status='Existing')::int active,count(*) filter(where source='toronto' and status<>'Existing')::int removed,count(*) filter(where source='manual')::int manual from public.bins where (source='toronto' or scope=$1) and approval='approved'",
            [scope],
          );
          const manual = await query(
            "select data from public.bins where source='manual' and scope=$1 and status='Existing' and approval='approved'",
            [scope],
          );
          return json({
            ...(await summary(scope, window)),
            inventory: counts,
            manualBins: manual.map((r) => r.data),
            scope,
            updatedAt: new Date().toISOString(),
          });
        });
      }
      const all = await bins(scope);
      return json({
        ...(await summary(scope, window)),
        inventory: {
          total: inventory().length,
          active: all.filter((b) => b.status === "Existing").length,
          removed: inventory().filter((b) => b.status !== "Existing").length,
          manual: all.filter((b) => b.source === "manual").length,
        },
        manualBins: all.filter(
          (b) => b.source === "manual" && b.status === "Existing",
        ),
        scope,
        updatedAt: new Date().toISOString(),
      });
    }
    if (route === "vision/preview" && method === "POST") {
      const started = Date.now();
      const connection = await config();
      assert(connection.apiKey, 503, "Connect Gemini on the computer running the app to enable camera guidance.");
      const health = await providerHealth();
      if (health && health.state !== "ready")
        throw new HttpError(health.state === "billing_required" ? 402 : 503, health.message);
      const input = z.object({
        image: z.string(),
        capturedAt: z.string().datetime(),
        mode: z.enum(["auto", "bin", "item"]),
        method: z.enum(["camera", "upload"]),
      }).parse(await body(req));
      assert(Math.abs(Date.now() - Date.parse(input.capturedAt)) < 30000, 400, "Capture a fresh view and try again.");
      await consume(`global:${new Date().toISOString().slice(0, 10)}`, Number(process.env.DAILY_SCAN_LIMIT || 500));
      await consume(`vision-preview:${s.id}:${Math.floor(Date.now() / 60000)}`, 40);
      const image = await sanitizeImage(input.image);
      const analysisStarted = Date.now();
      const detection = await analyze(image.buffer, input.mode, {
        connection,
        signal: req.signal,
        recordSuccessHealth: health?.state !== "ready",
      });
      const analysisMs = Date.now() - analysisStarted;
      // Analysis stays transient. A user can subsequently confirm a report and
      // attach this photo through /reports; automated evidence still uses /scan.
      return json({
        detection, guidance: guidance(detection.components),
        capturedAt: input.capturedAt, receivedAt: new Date().toISOString(),
        width: image.width, height: image.height,
        latencyMs: Date.now() - started, analysisMs, storageMs: 0,
        provider: "gemini", model: connection.model,
      });
    }
    if (route === "scan" && method === "POST") {
      assert(
        (await config()).apiKey,
        503,
        "Connect Gemini in Setup to enable live camera analysis. You can still explore the map or send a manual report.",
      );
      const health = await providerHealth();
      if (health && health.state !== "ready")
        throw new HttpError(
          health.state === "billing_required" ? 402 : 503,
          health.message,
        );
      const input = z
        .object({
          image: z.string(),
          capturedAt: z.string().datetime(),
          mode: z.enum(["auto", "bin", "item"]),
          method: z.enum(["camera", "upload"]),
        })
        .parse(await body(req));
      assert(
        Math.abs(Date.now() - Date.parse(input.capturedAt)) < 30000,
        400,
        "Capture a fresh frame and try again.",
      );
      await consume(
        `global:${new Date().toISOString().slice(0, 10)}`,
        Number(process.env.DAILY_SCAN_LIMIT || 500),
      );
      await consume(
        `scan:${s.id}:${Math.floor(Date.now() / 3600000)}`,
        Number(process.env.SESSION_SCAN_LIMIT || 100),
      );
      const image = await sanitizeImage(input.image);
      const started = Date.now();
      const detection = await analyze(image.buffer, input.mode, { signal: req.signal });
      assert(!req.signal.aborted, 499, "Photo analysis cancelled.");
      await cleanup();
      assert(!req.signal.aborted, 499, "Photo analysis cancelled.");
      const mediaId = uid();
      await saveMedia(mediaId, image.buffer, true);
      if (req.signal.aborted) {
        await removeMedia(mediaId);
        throw new HttpError(499, "Photo analysis cancelled.");
      }
      const scan: Scan = {
        id: uid(),
        sessionId: s.id,
        scope,
        capturedAt: input.capturedAt,
        receivedAt: new Date().toISOString(),
        method: input.method,
        frameHash: image.frameHash,
        perceptualHash: image.perceptualHash,
        detection,
        mediaId,
        width: image.width,
        height: image.height,
      };
      await put("scan", scan);
      return json({
        id: scan.id,
        detection,
        guidance: guidance(detection.components),
        capturedAt: scan.capturedAt,
        receivedAt: scan.receivedAt,
        width: scan.width,
        height: scan.height,
        latencyMs: Date.now() - started,
      });
    }
    if (route === "reports" && method === "POST") {
      const input = reportSchema.parse(await body(req));
      await consume(`report:${s.id}:${Math.floor(Date.now() / 3600000)}`, 40);
      let evidenceMediaId: string | undefined;
      if (input.image) {
        assert(
          input.source !== "camera",
          400,
          "Automatic evidence must come from server-validated scans.",
        );
        const image = await sanitizeImage(input.image);
        evidenceMediaId = uid();
        await saveMedia(evidenceMediaId, image.buffer);
      }
      const { image: unused, ...fields } = input;
      try {
        const result = await createReport(
          { ...fields, evidenceMediaId },
          s,
          scope,
        );
        if (result.duplicate && evidenceMediaId)
          await removeMedia(evidenceMediaId);
        return json(result, result.duplicate ? 200 : 201);
      } catch (e) {
        if (evidenceMediaId) await removeMedia(evidenceMediaId);
        throw e;
      }
    }

    if (route === "reports" && method === "GET") {
      const offset = Math.max(
        0,
        Number(req.nextUrl.searchParams.get("offset") || 0),
      );
      const limit = Math.min(
        100,
        Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 30)),
      );
      const all = (await list<Report>("report", scope))
        .filter((r) => r.status === "active")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json({
        reports: await Promise.all(
          all.slice(offset, offset + limit).map(publicReport),
        ),
        total: all.length,
        nextOffset: offset + limit < all.length ? offset + limit : null,
      });
    }
    if (
      parts[0] === "reports" &&
      parts[2] === "withdraw" &&
      method === "POST"
    ) {
      const r = await get<Report>("report", parts[1]);
      assert(r && r.scope === scope, 404, "Report not found.");
      const input = z
        .object({ recovery: z.string().optional() })
        .parse(await body(req));
      assert(
        r.sessionId === s.id ||
          s.admin ||
          (input.recovery && equal(hash(input.recovery), r.recoveryHash)),
        403,
        "Use the original device or private receipt to withdraw this report.",
      );
      await transaction(async () => {
        await put("report", { ...r, status: "withdrawn" });
        const c = (await get<Case>("case", r.caseId))!;
        c.actions.push({
          id: uid(),
          type: "withdrawn",
          at: new Date().toISOString(),
          actor: s.admin ? "Operator" : "Reporter",
          note: "Observation withdrawn.",
        });
        if (
          isCaseOpen(c.state) &&
          !(await list<Report>("report", scope)).some(
            (x) => x.caseId === c.id && x.status === "active",
          )
        ) {
          c.condition = "unknown";
          c.state = "needs_review";
        }
        c.updatedAt = new Date().toISOString();
        await put("case", c);
      });
      return json({ ok: true });
    }
    if (parts[0] === "receipts" && parts.length === 2 && method === "POST") {
      const input = z
        .object({ recovery: z.string().optional() })
        .parse(await body(req));
      const r = await get<Report>("report", parts[1]);
      assert(
        r &&
          (s.admin ||
            r.sessionId === s.id ||
            (input.recovery && equal(hash(input.recovery), r.recoveryHash))),
        404,
        "Private receipt unavailable. Use the original device or private recovery link.",
      );
      const c = await get<Case>("case", r.caseId);
      return json({
        report: { ...(await publicReport(r)), note: r.note },
        case: c,
        mediaId: r.mediaId,
      });
    }
    if (parts[0] === "cases" && parts.length === 2 && method === "GET") {
      const c = await get<Case>("case", parts[1]);
      assert(c && c.scope === scope, 404, "Case not found.");
      if (!s.admin) {
        const reports = (await list<Report>("report", scope)).filter(
          (r) => r.caseId === c.id && r.status === "active",
        );
        assert(reports.length, 404, "Case not found.");
        return json({
          case: await publicCase(c),
          reports: await Promise.all(reports.map(publicReport)),
          readOnly: true,
        });
      }
      return json({
        case: c,
        reports: await Promise.all(
          (await list<Report>("report", scope))
            .filter((r) => r.caseId === c.id)
            .map(async (r) => ({
              ...(await publicReport(r)),
              note: r.note,
              mediaId: r.mediaId,
            })),
        ),
      });
    }
    if (parts[0] === "cases" && parts[2] === "actions" && method === "POST") {
      admin(s);
      const input = z
        .object({
          type: z.enum([
            "needs_review",
            "ready",
            "assign",
            "work_complete",
            "recheck",
            "reopen",
            "associate",
          ]),
          note: z.string().min(3).max(1000),
          owner: z.string().max(80).optional(),
          binId: z.string().optional(),
          image: z.string().optional(),
        })
        .parse(await body(req));
      let mediaId: string | undefined;
      if (["work_complete", "recheck"].includes(input.type))
        assert(
          input.image,
          400,
          "Attach a fresh follow-up photo for this action.",
        );
      if (input.image) {
        const image = await sanitizeImage(input.image);
        mediaId = uid();
        await saveMedia(mediaId, image.buffer);
      }
      return json(
        await transaction(async () => {
          const c = await get<Case>("case", parts[1]);
          assert(c && c.scope === scope, 404, "Case not found.");
          const now = new Date().toISOString();
          if (input.type === "associate") {
            const target = await binById(input.binId || "", scope);
            assert(
              target &&
                target.approval === "approved" &&
                target.status === "Existing",
              400,
              "Choose an approved physical bin.",
            );
            c.binId = target.id;
            c.location = [target.lng, target.lat];
            for (const r of (await list<Report>("report", scope)).filter(
              (r) => r.caseId === c.id,
            ))
              await put("report", {
                ...r,
                binId: target.id,
                location: c.location,
                matchMethod: "operator_review",
              });
          } else if (input.type === "assign") {
            assert(input.owner?.trim(), 400, "Enter the assigned operator.");
            c.owner = input.owner;
            c.state = "assigned";
          } else if (input.type === "work_complete") {
            c.state = "work_complete";
            c.condition = "unknown";
          } else if (input.type === "recheck") {
            assert(
              ["work_complete", "rechecked"].includes(c.state),
              400,
              "Mark the work complete before recording a clear-condition recheck.",
            );
            c.state = "rechecked";
            c.condition = "clear";
          } else if (input.type === "reopen") {
            c.state = "reopened";
            c.condition = "overflowing";
          } else c.state = input.type;
          c.updatedAt = now;
          c.actions.push({
            id: uid(),
            type: input.type,
            at: now,
            actor: "Local operator",
            note: input.note,
            ...(mediaId ? { mediaId } : {}),
          });
          await put("case", c);
          return c;
        }),
      );
    }
    if (
      parts[0] === "cases" &&
      ["merge", "split"].includes(parts[2]) &&
      method === "POST"
    ) {
      admin(s);
      const input = z
        .object({
          targetId: z.string().optional(),
          reportId: z.string().optional(),
          note: z.string().min(12).max(1000),
        })
        .parse(await body(req));
      return json(
        await transaction(async () => {
          const from = await get<Case>("case", parts[1]);
          assert(from && from.scope === scope, 404, "Case not found.");
          const now = new Date().toISOString();
          const moving = (await list<Report>("report", scope)).filter(
            (r) => r.caseId === from.id,
          );
          if (parts[2] === "merge") {
            const target = await get<Case>("case", input.targetId || "");
            assert(
              target && target.scope === scope && target.id !== from.id,
              400,
              "Choose a different case in this space.",
            );
            assert(
              target.binId === from.binId,
              400,
              "Associate both cases with the same bin before merging.",
            );
            for (const r of moving)
              await put("report", { ...r, caseId: target.id });
            target.actions.push(...from.actions, {
              id: uid(),
              type: "merge",
              at: now,
              actor: "Local operator",
              note: input.note,
            });
            target.updatedAt = now;
            await put("case", target);
            await put("case", { ...from, mergedInto: target.id });
            await put("audit", {
              id: uid(),
              scope,
              type: "case_merge",
              fromId: from.id,
              targetId: target.id,
              note: input.note,
              at: now,
            });
            return { caseId: target.id };
          }
          const report = moving.find((r) => r.id === input.reportId);
          assert(
            report && moving.length > 1,
            400,
            "Select one observation from a case with multiple observations.",
          );
          const next: Case = {
            ...from,
            id: uid(),
            openedAt: report.createdAt,
            updatedAt: now,
            state: "needs_review",
            previousId: from.id,
            owner: undefined,
            actions: [
              {
                id: uid(),
                type: "split",
                at: now,
                actor: "Local operator",
                note: input.note,
              },
            ],
          };
          await put("case", next);
          await put("report", { ...report, caseId: next.id });
          from.actions.push({
            id: uid(),
            type: "split",
            at: now,
            actor: "Local operator",
            note: input.note,
          });
          await put("case", from);
          return { caseId: next.id };
        }),
      );
    }
    if (parts[0] === "cases" && parts[2] === "handoff" && method === "GET") {
      admin(s);
      const c = await get<Case>("case", parts[1]);
      assert(c && c.scope === scope, 404, "Case not found.");
      const bin = c.binId ? await binById(c.binId, scope) : undefined;
      return json({
        notice:
          "Prepared in Bin There Done That. Not submitted to Toronto 311.",
        officialUrl: "https://www.toronto.ca/home/311-toronto-at-your-service/",
        case: c,
        bin: bin || null,
        observations: await Promise.all(
          (await list<Report>("report", scope))
            .filter((r) => r.caseId === c.id && r.status === "active")
            .map(publicReport),
        ),
      });
    }
    if (route === "demo/sessions" && method === "POST") {
      admin(s);
      const input = z
        .object({ title: z.string().min(3).max(100), binId: z.string() })
        .parse(await body(req));
      const bin = await binById(input.binId);
      assert(
        bin && bin.status === "Existing",
        400,
        "Choose an active Toronto bin.",
      );
      const writeKey = secret();
      const demo: Demo = {
        ...input,
        id: uid(),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
        writeHash: hash(writeKey),
      };
      await put("demo", demo);
      return json(
        {
          id: demo.id,
          title: demo.title,
          bin,
          writeKey,
          expiresAt: demo.expiresAt,
        },
        201,
      );
    }
    if (
      parts[0] === "demo" &&
      parts[1] === "sessions" &&
      parts.length === 3 &&
      method === "GET"
    ) {
      const d = await get<Demo>("demo", parts[2]);
      assert(
        d && Date.parse(d.expiresAt) > Date.now(),
        404,
        "Demo session expired.",
      );
      return json({
        id: d.id,
        title: d.title,
        bin: await binById(d.binId),
        expiresAt: d.expiresAt,
      });
    }
    if (
      parts[0] === "demo" &&
      parts[1] === "sessions" &&
      parts[3] === "join" &&
      method === "POST"
    ) {
      const d = await get<Demo>("demo", parts[2]);
      const input = z
        .object({ key: z.string().max(100) })
        .parse(await body(req));
      assert(
        d &&
          Date.parse(d.expiresAt) > Date.now() &&
          equal(hash(input.key), d.writeHash),
        403,
        "This private demo link is invalid or expired.",
      );
      await put("session", {
        ...s,
        demoScopes: [...new Set([...s.demoScopes, `demo:${d.id}`])],
      });
      return json({ ok: true });
    }
    if (parts[0] === "media" && parts.length === 2 && method === "GET") {
      assert(/^[0-9a-f-]{36}$/.test(parts[1]), 404, "Image not found.");
      const r = (await list<Report>("report")).find(
        (r) => r.mediaId === parts[1],
      );
      const ownedScan = (await list<Scan>("scan")).find(
        (x) => x.mediaId === parts[1] && x.sessionId === s.id,
      );
      const ownedBin = (await list<BinEvidence>("bin_evidence")).some(
        (x) => x.mediaId === parts[1] && x.sessionId === s.id,
      );
      assert(
        s.admin || ownedScan || ownedBin || r?.sessionId === s.id,
        403,
        "This evidence image is private.",
      );
      return new NextResponse(new Uint8Array(await readMedia(parts[1])), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, no-store",
        },
      });
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (e) {
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof ZodError
          ? 400
          : (
              e as {
                status?: number;
              }
            ).status || 500;
    const message =
      e instanceof ZodError
        ? "Some fields are invalid. Check the form and try again."
        : status < 500 || e instanceof HttpError
          ? (e as Error).message
          : "The action could not be completed. Please retry.";
    return attachCookie(
      NextResponse.json(
        { error: message },
        { status, headers: { "Cache-Control": "no-store" } },
      ),
      token,
      req,
    );
  }
}
const cachedHandler = (req: NextRequest) =>
  withRequestCache(() => handler(req));
export { cachedHandler as GET, cachedHandler as POST, cachedHandler as PATCH };
