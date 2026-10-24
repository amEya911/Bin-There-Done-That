import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
process.env.DATA_BACKEND = "postgres";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/[[...path]]/route";
import { get, put, uid, hash } from "../lib/db";
import { pool, query, pgNearby, pgArea } from "../lib/postgres-store";
import { removeMedia } from "../lib/media";
import type { Bin } from "../lib/types";
const scope = `demo:${uid()}`,
  demoId = scope.slice(5),
  sessions = new Set<string>(),
  media = new Set<string>();
const originFlag = process.argv.indexOf("--origin");
const origin = originFlag >= 0 ? process.argv[originFlag + 1] : undefined;
if (origin && !["http:", "https:"].includes(new URL(origin).protocol))
  throw new Error("Use an HTTP(S) application origin for verification.");
class Visitor {
  cookie = "";
  async response(url: string, method = "GET", body?: unknown) {
    const target = new URL(url, origin || "http://localhost:3000");
    const options = {
      method,
      headers: {
        host: target.host,
        origin: target.origin,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const r = origin
      ? await fetch(target, options)
      : await (method === "GET" ? GET : POST)(new NextRequest(target, options));
    if (r.headers.get("set-cookie")) {
      this.cookie = r.headers.get("set-cookie")!.split(";")[0];
      sessions.add(hash(this.cookie.split("=")[1]));
    }
    return r;
  }
  async request(url: string, method = "GET", body?: unknown) {
    const r = await this.response(url, method, body);
    return { status: r.status, data: await r.json() };
  }
  async grant() {
    await this.request("/api/status");
    const id = hash(this.cookie.split("=")[1]);
    const value = await get<any>("session", id);
    assert.ok(value);
    await put("session", { ...value, demoScopes: [scope] }, scope);
  }
}
const a = new Visitor(),
  b = new Visitor(),
  reader = new Visitor();
const suffix = `?scope=${encodeURIComponent(scope)}`;
try {
  const [original] = await query<{ data: Bin }>(
    "select data from public.bins where source='toronto' and status='Existing' limit 1",
  );
  const bin = original.data;
  const nearest = await pgNearby([bin.lng, bin.lat], "public", 30);
  assert.ok(nearest.some((x) => x.id === bin.id && x.distance < 0.01));
  assert.equal(
    (await pgArea([-79.418, 43.65], "public"))?.id,
    "downtown-pilot",
  );
  const spatial = await query(
    "explain select id from public.bins order by location operator(extensions.<->) extensions.st_setsrid(extensions.st_makepoint(-79.39,43.65),4326)::extensions.geography limit 5",
  );
  assert.match(
    spatial.map((r: any) => r["QUERY PLAN"]).join("\n"),
    /bins_location_gist/,
  );
  console.log(
    "PostGIS nearest, boundary containment and spatial index verified.",
  );
  await put(
    "demo",
    {
      id: demoId,
      title: "Isolated cloud verification; no public incidents",
      binId: bin.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      writeHash: "verification-only",
    },
    scope,
  );
  await a.grant();
  await b.grant();
  const image =
    "data:image/jpeg;base64," +
    fs
      .readFileSync("public/images/overflow-bin-hamburg.jpg")
      .toString("base64");
  const input = {
    binId: bin.id,
    location: [bin.lng, bin.lat],
    matchMethod: "selected",
    source: "manual",
    issue: "overflowing",
    scanIds: [],
    note: "Isolated test record; not a public observation",
    idempotencyKey: uid(),
    image,
  };
  const [first, second] = await Promise.all([
    a.request("/api/reports" + suffix, "POST", input),
    b.request("/api/reports" + suffix, "POST", {
      ...input,
      image: undefined,
      idempotencyKey: uid(),
    }),
  ]);
  assert.equal(first.status, 201, first.data.error);
  assert.equal(second.status, 201, second.data.error);
  assert.equal(first.data.report.caseId, second.data.report.caseId);
  const accepted = await reader.request(
    "/api/dashboard" + suffix + "&window=all",
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.totalReports, 2);
  assert.equal(accepted.data.activeCases, 1);
  assert.equal(accepted.data.affectedBins, 1);
  const detail = await reader.request("/api/bins/" + bin.id + suffix);
  assert.equal(detail.data.reports.length, 2);
  assert.deepEqual(detail.data.ownReportIds, []);
  assert.equal(detail.data.reports[0].note, "");
  assert.equal(detail.data.reports[0].sessionId, undefined);
  const [{ data: stored }] = await query(
    "select data from public.reports where id=$1",
    [first.data.report.id],
  );
  media.add(stored.mediaId);
  assert.equal(
    fs.existsSync(
      path.join(
        process.env.TRASHME_DATA_DIR || ".data",
        "media",
        stored.mediaId + ".jpg",
      ),
    ),
    false,
    "Cloud evidence must never be written locally",
  );
  assert.equal(
    (await reader.response("/api/media/" + stored.mediaId + suffix)).status,
    403,
  );
  const photo = await a.response("/api/media/" + stored.mediaId + suffix);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("Content-Type"), "image/jpeg");
  assert.ok((await photo.arrayBuffer()).byteLength > 0);
  console.log(
    "Two independent reporters and an anonymous reader share the cloud data; image stored only in private Supabase Storage.",
  );
  const caseId = first.data.report.caseId;
  const closed = await a.request(
    "/api/bins/" + bin.id + "/resolve" + suffix,
    "POST",
    { confirmed: true, caseIds: [caseId] },
  );
  assert.equal(closed.status, 200, closed.data.error);
  const done = await reader.request("/api/dashboard" + suffix + "&window=all");
  assert.equal(done.data.totalReports, 0);
  assert.equal(done.data.activeCases, 0);
  assert.equal(done.data.affectedBins, 0);
  assert.equal(done.data.historicalReports, 2);
  assert.equal(done.data.mapPoints.length, 0);
  assert.equal(
    (await reader.request("/api/bins/" + bin.id + suffix)).data.reports.length,
    2,
  );
  const next = await b.request("/api/reports" + suffix, "POST", {
    ...input,
    image: undefined,
    idempotencyKey: uid(),
  });
  assert.equal(next.status, 201);
  assert.notEqual(next.data.report.caseId, caseId);
  await a.request("/api/bins/" + bin.id + "/resolve" + suffix, "POST", {
    confirmed: true,
    caseIds: [caseId],
  });
  assert.equal(
    (await reader.request("/api/dashboard" + suffix + "&window=all")).data
      .totalReports,
    1,
  );
  assert.equal(
    (
      await reader.request(
        "/api/reports/" + next.data.report.id + "/withdraw" + suffix,
        "POST",
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await b.request(
        "/api/reports/" + next.data.report.id + "/withdraw" + suffix,
        "POST",
        {},
      )
    ).status,
    200,
  );
  assert.equal(
    (await reader.request("/api/dashboard" + suffix + "&window=all")).data
      .totalReports,
    0,
  );
  console.log(
    "Resolution, recurrence, stale confirmations, private withdrawal, retained history and matching open counts verified.",
  );
  const permissions = await query(
    "select relname,relrowsecurity,has_table_privilege('anon',c.oid,'select') anon_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('bins','areas','cases','reports')",
  );
  assert.ok(permissions.every((r: any) => r.relrowsecurity && !r.anon_select));
  const [bucket] = await query(
    "select public from storage.buckets where id='bin-evidence'",
  );
  assert.equal(bucket.public, false);
  const publicA = await a.request("/api/dashboard?window=all"),
    publicB = await reader.request("/api/dashboard?window=all");
  assert.equal(publicA.status, 200);
  assert.equal(publicB.status, 200);
  assert.deepEqual(publicA.data.reports, publicB.data.reports);
  console.log(
    "RLS, private bucket and anonymous public report projections verified.",
  );
  await put(
    "area",
    {
      id: uid(),
      scope,
      name: "Isolated verification area",
      active: true,
      polygon: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0.001],
        [0, 0],
      ],
      createdAt: new Date().toISOString(),
    },
    scope,
  );
  const addition = {
    image,
    location: [0.0005, 0.0005],
    accuracy: 5,
    locatedAt: new Date().toISOString(),
    idempotencyKey: uid(),
  };
  const additions = await Promise.all([
    a.request("/api/bins/submit" + suffix, "POST", addition),
    b.request("/api/bins/submit" + suffix, "POST", {
      ...addition,
      idempotencyKey: uid(),
    }),
  ]);
  assert.deepEqual(additions.map((r) => r.status).sort(), [201, 409]);
  const added = additions.find((r) => r.status === 201)!;
  const matching = await pgNearby([0.0005, 0.0005], scope, 15);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].id, added.data.bin.id);
  assert.equal(
    (await reader.request("/api/bins/" + added.data.bin.id + suffix)).status,
    200,
  );
  console.log(
    "Concurrent missing-bin additions enforce the PostGIS 15 metre block and share the accepted bin.",
  );
} finally {
  const retained = await query(
    "select data->>'mediaId' id from public.reports where scope=$1 and data->>'mediaId' is not null union select data->>'mediaId' id from app_private.records where scope=$1 and data->>'mediaId' is not null",
    [scope],
  );
  for (const row of retained) media.add(row.id);
  for (const id of media) await removeMedia(id);
  await query(
    "delete from app_private.report_keys where report_id in (select id from public.reports where scope=$1)",
    [scope],
  );
  await query("delete from public.reports where scope=$1", [scope]);
  await query("delete from public.cases where scope=$1", [scope]);
  await query("delete from public.bins where scope=$1 and source='manual'", [
    scope,
  ]);
  await query("delete from public.areas where scope=$1", [scope]);
  await query(
    "delete from app_private.records where scope=$1 or (kind='session' and id=any($2::text[]))",
    [scope, [...sessions]],
  );
  await query(
    "delete from app_private.quotas where split_part(key,':',2)=any($1::text[])",
    [[...sessions]],
  );
  await pool().end();
  console.log("Isolated verification records and evidence removed.");
}
