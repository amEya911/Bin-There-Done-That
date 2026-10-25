import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "trashme-test-"));
process.env.TRASHME_DATA_DIR = temp;
delete process.env.GEMINI_API_KEY;
delete process.env.ADMIN_PASSWORD;
process.env.DATA_BACKEND = "sqlite";
const store = await import("../lib/db");
const service = await import("../lib/service");
const { POST, GET, PATCH } = await import("../app/api/[[...path]]/route");
const { inventory } = await import("../lib/inventory");
const { contains, validPolygon, autoMatch } = await import("../lib/geo");
const { normalizeDetection } = await import("../lib/vision");
const { guidance } = await import("../lib/rules");
const { session } = await import("../lib/auth");
import type { Scan, Report } from "../lib/types";
class Client {
  cookie = "";
  async request(url: string, method = "GET", data?: unknown) {
    const req = new NextRequest("http://localhost:3000" + url, {
      method,
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const r = await (
      method === "GET" ? GET : method === "PATCH" ? PATCH : POST
    )(req);
    const cookie = r.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return { status: r.status, data: await r.json() };
  }
  async session() {
    const value = await session(
      new NextRequest("http://localhost:3000/api/status", {
        headers: { cookie: this.cookie },
      }),
    );
    assert.ok(value);
    return value;
  }
}
const manager = new Client();
let binId = "";
let created: any;
after(() => {
  store.db().close();
  fs.rmSync(temp, { recursive: true, force: true });
});
test("import preserves 10,457 distinct City identities and excludes removed bins from matching", () => {
  const all = inventory();
  assert.equal(all.length, 10457);
  assert.equal(new Set(all.map((b) => b.id)).size, 10457);
  assert.equal(all.filter((b) => b.status === "Existing").length, 9822);
  assert.ok(all.every((b) => b.lng < 0 && b.lat > 0));
});
test("geofence includes boundary, rejects outside and self-intersection; GPS ambiguity abstains", () => {
  const r: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  assert.equal(validPolygon(r), true);
  assert.equal(contains([0, 0.5], r), true);
  assert.equal(contains([1, 1], r), true);
  assert.equal(contains([1.01, 0.5], r), false);
  assert.equal(
    validPolygon([
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
      [0, 0],
    ]),
    false,
  );
  assert.equal(
    autoMatch(
      [
        { id: "a", distance: 4 },
        { id: "b", distance: 20 },
      ],
      8,
    ),
    null,
  );
  assert.equal(autoMatch([{ id: "a", distance: 4 }], 30), null);
  assert.equal(
    autoMatch(
      [
        { id: "a", distance: 4 },
        { id: "b", distance: 55 },
      ],
      8,
    ),
    "a",
  );
});
test("anonymous management writes are denied; missing model key returns an honest unavailable result", async () => {
  const c = new Client();
  assert.equal((await c.request("/api/bins", "POST", {})).status, 401);
  const scan = await c.request("/api/scan", "POST", {});
  assert.equal(scan.status, 503);
  const preview = await c.request("/api/vision/preview", "POST", {});
  assert.equal(preview.status, 503);
  assert.equal((await store.list("scan")).length, 0);
});
test("local setup creates hashed management credentials and verifies authentication", async () => {
  const r = await manager.request("/api/settings", "POST", {
    password: "temporary-test-password-452",
    apiKey: "",
    model: "gemini-3.8-flash",
  });
  assert.equal(r.status, 200);
  assert.equal((await manager.request("/api/status")).data.isAdmin, true);
  const settings = await store.get<any>("setting", "connection");
  assert.notEqual(settings.passwordHash, "temporary-test-password-452");
  assert.match(settings.passwordHash, /:/);
  assert.equal(
    (
      await new Client().request("/api/auth/login", "POST", {
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await new Client().request("/api/auth/login", "POST", {
        password: "temporary-test-password-452",
      })
    ).status,
    200,
  );
});
test("manual bin registration enforces area, review status, provenance, duplicate review and reimport preservation", async () => {
  const input = {
    name: "Test physical bin",
    address: "Designated area test landmark",
    lng: -79.395,
    lat: 43.655,
    areaId: "downtown-pilot",
    status: "Existing",
    approval: "pending",
    duplicateExplanation:
      "This is a separate physical bin checked by the operator.",
  };
  assert.equal(
    (await manager.request("/api/bins", "POST", { ...input, lng: -80 })).status,
    400,
  );
  const result = await manager.request("/api/bins", "POST", input);
  assert.equal(result.status, 201);
  binId = result.data.id;
  assert.equal(result.data.source, "manual");
  assert.ok(!result.data.sourceId);
  assert.ok(
    !(await service.nearby([input.lng, input.lat])).some((b) => b.id === binId),
  );
  assert.equal(
    (
      await manager.request("/api/bins/" + binId, "PATCH", {
        approval: "approved",
        note: "Physical location and identity reviewed.",
      })
    ).status,
    200,
  );
  assert.ok(
    (await service.nearby([input.lng, input.lat])).some((b) => b.id === binId),
  );
  assert.equal(inventory().length, 10457);
  assert.ok(await service.binById(binId));
  assert.equal(
    (
      await manager.request("/api/bins", "POST", {
        ...input,
        duplicateExplanation: "",
      })
    ).status,
    409,
  );
});
test("three observers create three accepted reports, one case and one affected bin; retries stay idempotent", async () => {
  const observers = [new Client(), new Client(), new Client()];
  const input = {
    binId,
    location: [-79.395, 43.655],
    matchMethod: "selected",
    scanIds: [],
    idempotencyKey: "manual-observation-12345",
    source: "manual",
    issue: "overflowing",
    note: "Private observation note",
  };
  const results = await Promise.all(
    await Promise.all(
      observers.map(
        async (c) => await c.request("/api/reports", "POST", input),
      ),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  created = { client: observers[0], ...results[0].data };
  assert.equal(
    (await observers[0].request("/api/reports", "POST", input)).data.duplicate,
    true,
  );
  const d = (await new Client().request("/api/dashboard?window=all")).data;
  assert.equal(d.totalReports, 3);
  assert.equal(d.activeCases, 1);
  assert.equal(d.affectedBins, 1);
  assert.equal(d.binCounts[binId], 3);
  assert.equal(d.reports[0].note, "");
  assert.ok(!("recoveryHash" in d.reports[0]));
  assert.ok(!("sessionId" in d.reports[0]));
  assert.equal((await store.list<Report>("report")).length, 3);
});
test("withdrawal requires owner or hashed recovery secret and recomputes counts", async () => {
  const stranger = new Client();
  assert.equal(
    (
      await stranger.request(
        `/api/reports/${created.report.id}/withdraw`,
        "POST",
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await stranger.request(`/api/receipts/${created.report.id}`, "POST", {
        recovery: "wrong-key",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await stranger.request(`/api/receipts/${created.report.id}`, "POST", {
        recovery: created.recovery,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await stranger.request(
        `/api/reports/${created.report.id}/withdraw`,
        "POST",
        { recovery: created.recovery },
      )
    ).status,
    200,
  );
  assert.equal((await service.summary("public", "all")).totalReports, 2);
});
async function scans(
  client: Client,
  scope = "public",
  overflow = true,
): Promise<Scan[]> {
  const currentSession = await client.session();
  return [0, 1].map((i) => ({
    id: store.uid(),
    sessionId: currentSession.id,
    scope,
    capturedAt: new Date(Date.now() - 5000 + i * 1800).toISOString(),
    receivedAt: new Date().toISOString(),
    frameHash: "fresh-frame-" + i,
    perceptualHash: "0".repeat(64),
    detection: {
      scene: "bin",
      target: "street bin",
      certainty: "high",
      overflow,
      evidence: overflow ? ["Waste visibly protrudes above the opening."] : [],
      components: [],
      box: { x: 0.2, y: 0.2, width: 0.5, height: 0.6 },
      quality: [],
      message: "Visible bin",
    },
    mediaId: store.uid(),
    width: 640,
    height: 480,
    method: "camera",
  }));
}
test("automatic reporting verifies two independent fresh frames and suppresses continued same-session/bin reports", async () => {
  const c = new Client();
  await c.request("/api/status");
  const pair = await scans(c);
  await Promise.all(pair.map(async (v) => await store.put("scan", v)));
  const input = {
    binId,
    location: [-79.395, 43.655],
    matchMethod: "selected",
    scanIds: pair.map((v) => v.id),
    idempotencyKey: "auto-sequence-001",
    source: "camera",
    issue: "overflowing",
    note: "",
  };
  assert.equal(
    (
      await c.request("/api/reports", "POST", {
        ...input,
        scanIds: [pair[0].id, pair[0].id],
      })
    ).status,
    400,
  );
  assert.equal((await c.request("/api/reports", "POST", input)).status, 201);
  assert.equal(
    (
      await c.request("/api/reports", "POST", {
        ...input,
        idempotencyKey: "auto-sequence-002",
      })
    ).data.duplicate,
    true,
  );
  const next = await scans(c);
  await Promise.all(next.map(async (v) => await store.put("scan", v)));
  assert.equal(
    (
      await c.request("/api/reports", "POST", {
        ...input,
        scanIds: next.map((v) => v.id),
        idempotencyKey: "auto-sequence-003",
      })
    ).data.duplicate,
    true,
  );
  assert.equal((await service.summary("public", "all")).totalReports, 3);
});
test("negative, replayed, stale, shifted and foreign-scope camera evidence cannot create an automatic report", async () => {
  const c = new Client();
  await c.request("/api/status");
  const currentSession = await c.session();
  const base = await scans(c);
  const validate = (p: Scan[]) =>
    service.consistentScans(p, currentSession.id, "public");
  assert.throws(() =>
    validate(
      base.map((s) => ({
        ...s,
        detection: { ...s.detection, overflow: false },
      })),
    ),
  );
  assert.throws(() => validate(base.map((s) => ({ ...s, frameHash: "same" }))));
  assert.throws(() =>
    validate(
      base.map((s) => ({
        ...s,
        receivedAt: new Date(Date.now() - 120000).toISOString(),
      })),
    ),
  );
  assert.throws(() =>
    validate(base.map((s) => ({ ...s, scope: "demo:foreign" }))),
  );
  assert.throws(() =>
    validate([
      base[0],
      {
        ...base[1],
        detection: {
          ...base[1].detection,
          box: { x: 0, y: 0, width: 0.1, height: 0.1 },
        },
      },
    ]),
  );
});
test("retired demo APIs return 404 and cannot create sessions or grant access", async () => {
  const before = (await service.summary("public", "all")).totalReports;
  const demoCount = (await store.list("demo")).length;
  const c = new Client();
  for (const client of [c, manager]) {
    const result = await client.request("/api/demo/sessions", "POST", {
      title: "Retired projector session",
      binId: inventory()[0].id,
    });
    assert.equal(result.status, 404);
  }
  assert.equal((await store.list("demo")).length, demoCount);
  const id = "retired-demo-fixture";
  await store.put("demo", {
    id,
    title: "Previously created demo",
    binId: inventory()[0].id,
    writeHash: store.hash("retired-demo-write-key"),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  try {
    for (const client of [c, manager]) {
      assert.equal(
        (await client.request(`/api/demo/sessions/${id}`)).status,
        404,
      );
      assert.equal(
        (
          await client.request(`/api/demo/sessions/${id}/join`, "POST", {
            key: "retired-demo-write-key",
          })
        ).status,
        404,
      );
    }
    assert.deepEqual((await c.session()).demoScopes, []);
  } finally {
    await store.remove("demo", id);
  }
  assert.equal((await service.summary("public", "all")).totalReports, before);
});
test("model normalization abstains on low certainty and sorting guidance does not invent unknown materials", () => {
  const d = normalizeDetection({
    scene: "bin",
    target: "bin",
    certainty: "low",
    overflow: true,
    evidence: ["Maybe full"],
    components: [],
    box: [100, 100, 800, 800],
    quality: [],
    message: "Unsure",
  });
  assert.equal(d.overflow, false);
  const component = {
    label: "Cup",
    item: "paper_cup",
    material: "paper",
    certainty: "high",
    box: [200, 200, 600, 600],
  };
  const blurred = normalizeDetection({
    ...d,
    scene: "item",
    certainty: "high",
    box: [100, 100, 800, 800],
    quality: ["Blurred"],
    components: [component],
  });
  assert.equal(guidance(blurred.components)[0].stream, "check");
  const unrelated = normalizeDetection({
    ...d,
    scene: "unrelated",
    box: null,
    components: [component],
  });
  assert.equal(unrelated.components.length, 0);
  assert.throws(() => normalizeDetection({ ...d, box: [900, 100, 100, 800] }));
  const tips = guidance([
    {
      label: "Cup body",
      item: "paper_cup",
      material: "paper",
      certainty: "high",
      box: { x: 0, y: 0, width: 0.2, height: 0.3 },
    },
    {
      label: "Lid",
      item: "unknown",
      material: "unknown",
      certainty: "low",
      box: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
    },
  ]);
  assert.equal(tips[0].stream, "recycling");
  assert.equal(tips[1].stream, "check");
  assert.ok(tips.every((t) => t.source.startsWith("https://www.toronto.ca/")));
});
test("unmatched public projection rounds private GPS and strips case ownership and notes", async () => {
  const c = new Client();
  const r = await c.request("/api/reports", "POST", {
    binId: null,
    location: [-79.3981234, 43.6519876],
    matchMethod: "pin",
    source: "manual",
    issue: "litter",
    note: "Private landmark text",
    idempotencyKey: "unmatched-observation-0001", // gitleaks:allow -- public deterministic idempotency fixture
  });
  assert.equal(r.status, 201);
  const d = await service.summary("public", "all");
  const p = d.reports.find((v) => v.id === r.data.report.id)!;
  assert.deepEqual(p.location, [-79.398, 43.652]);
  assert.equal(p.note, "");
  const episode = d.cases.find((v) => v.id === p.caseId)!;
  assert.deepEqual(episode.location, p.location);
  assert.equal(episode.owner, undefined);
});
test("case actions enforce authorization, photos for completion and recheck ordering", async () => {
  const cases = (await service.summary("public", "all")).cases;
  const id = cases.find((c) => c.binId === binId)!.id;
  assert.equal(
    (
      await new Client().request(`/api/cases/${id}/actions`, "POST", {
        type: "assign",
        owner: "Test operator",
        note: "Assigning a test issue.",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await manager.request(`/api/cases/${id}/actions`, "POST", {
        type: "assign",
        owner: "Test operator",
        note: "Assigning a test issue.",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await manager.request(`/api/cases/${id}/actions`, "POST", {
        type: "work_complete",
        note: "Claimed work without photo.",
      })
    ).status,
    400,
  );
  const packet = await manager.request(`/api/cases/${id}/handoff`);
  assert.equal(packet.status, 200);
  assert.match(packet.data.notice, /Not submitted/);
  const s = await service.summary("public", "all");
  assert.equal(s.cases.find((c) => c.id === id)!.owner, undefined);
});
test("manual photo fallback sanitizes evidence without AI and never invents its original capture time", async () => {
  const c = new Client();
  const image =
    "data:image/jpeg;base64," +
    fs
      .readFileSync("public/images/overflow-bin-hamburg.jpg")
      .toString("base64");
  const r = await c.request("/api/reports", "POST", {
    binId,
    location: [-79.395, 43.655],
    matchMethod: "selected",
    source: "upload",
    scanIds: [],
    image,
    issue: "overflowing",
    note: "Uploaded reference in isolated test storage.",
    idempotencyKey: "photo-fallback-0001",
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.report.capturedAt, null);
  const stored = (await store.get<Report>("report", r.data.report.id))!;
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(
    path.join(temp, "media", stored.mediaId + ".jpg"),
  ).metadata();
  assert.equal(metadata.exif, undefined);
  assert.ok(metadata.width! <= 1280);
  assert.equal(
    (await new Client().request("/api/media/" + stored.mediaId)).status,
    403,
  );
});
test("operator completion needs evidence, clear recheck remains separate, and later overflow opens another episode", async () => {
  const caseId = (await service.summary("public", "all")).cases.find(
    (c) => c.binId === binId,
  )!.id;
  const image =
    "data:image/jpeg;base64," +
    fs
      .readFileSync("public/images/overflow-bin-hamburg.jpg")
      .toString("base64");
  assert.equal(
    (
      await manager.request(`/api/cases/${caseId}/actions`, "POST", {
        type: "recheck",
        note: "Attempted before work completion.",
        image,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await manager.request(`/api/cases/${caseId}/actions`, "POST", {
        type: "work_complete",
        note: "Operator marks cleanup work complete in this test.",
        image,
      })
    ).status,
    200,
  );
  const done = await manager.request(`/api/cases/${caseId}/actions`, "POST", {
    type: "recheck",
    note: "Operator records clear condition; not an independent verification.",
    image,
  });
  assert.equal(done.status, 200);
  assert.equal(done.data.condition, "clear");
  assert.equal(done.data.state, "rechecked");
  const c = new Client();
  await c.request("/api/status");
  const pair = await scans(c);
  await Promise.all(pair.map(async (v) => await store.put("scan", v)));
  const later = await c.request("/api/reports", "POST", {
    binId,
    location: [-79.395, 43.655],
    matchMethod: "selected",
    source: "camera",
    scanIds: pair.map((v) => v.id),
    issue: "overflowing",
    note: "",
    idempotencyKey: "later-overflow-episode-001",
  });
  assert.equal(later.status, 201);
  assert.notEqual(later.data.report.caseId, caseId);
  assert.equal(
    (await store.get<any>("case", later.data.report.caseId)).previousId,
    caseId,
  );
});
test("splitting and merging preserve observation counts and an audit trail", async () => {
  const target = (await store.list<Report>("report")).find(
    (r) => r.binId === binId && r.status === "active",
  )!;
  const total = (await service.summary("public", "all")).historicalReports;
  const split = await manager.request(
    `/api/cases/${target.caseId}/split`,
    "POST",
    {
      reportId: target.id,
      note: "Evidence shows that this observation describes a distinct episode.",
    },
  );
  assert.equal(split.status, 200);
  assert.equal(
    (await service.summary("public", "all")).historicalReports,
    total,
  );
  const merged = await manager.request(
    `/api/cases/${split.data.caseId}/merge`,
    "POST",
    {
      targetId: target.caseId,
      note: "After review these observations describe the same physical bin episode.",
    },
  );
  assert.equal(merged.status, 200);
  assert.equal(
    (await service.summary("public", "all")).historicalReports,
    total,
  );
  assert.ok(
    (await store.get<any>("case", target.caseId)).actions.some(
      (a: any) => a.type === "merge",
    ),
  );
});
test("operator association links an unmatched observation to the correct approved bin", async () => {
  const r = (await store.list<Report>("report")).find((r) => !r.binId)!;
  assert.equal(
    (
      await manager.request(`/api/cases/${r.caseId}/actions`, "POST", {
        type: "associate",
        binId,
        note: "The physical bin and landmark were reviewed together.",
      })
    ).status,
    200,
  );
  const changed = (await store.get<Report>("report", r.id))!;
  assert.equal(changed.binId, binId);
  assert.deepEqual(changed.location, [-79.395, 43.655]);
});
test("provider billing failures are public-safe, pause scans and clear for a replacement credential", async () => {
  const provider = await import("../lib/provider-health");
  const prior = await store.get<any>("setting", "connection");
  await store.put("setting", {
    ...prior,
    apiKey: "temporary-test-credential-never-public",
  });
  const failure = await provider.providerFailure({
    status: 402,
    message: "raw provider diagnostic with private request information",
  });
  assert.equal(failure.status, 402);
  const c = new Client();
  const status = await c.request("/api/status");
  assert.equal(status.data.aiState, "billing_required");
  assert.match(status.data.aiError, /prepaid credits/);
  assert.ok(!JSON.stringify(status.data).includes("temporary-test-credential"));
  const scan = await c.request("/api/scan", "POST", {});
  assert.equal(scan.status, 402);
  assert.match(scan.data.error, /prepaid credits/);
  await store.put("setting", {
    ...prior,
    apiKey: "another-temporary-test-credential",
  });
  assert.equal(await provider.providerHealth(), undefined);
  await store.put("setting", prior);
});
test("automatic reports reject missing bins, defective evidence and future camera timestamps", async () => {
  const c = new Client();
  await c.request("/api/status");
  const currentSession = await c.session();
  const pair = await scans(c);
  assert.throws(() =>
    service.consistentScans(
      pair.map((s) => ({ ...s, detection: { ...s.detection, evidence: [] } })),
      currentSession.id,
      "public",
    ),
  );
  assert.throws(() =>
    service.consistentScans(
      pair.map((s) => ({
        ...s,
        detection: { ...s.detection, quality: ["Blurred"] },
      })),
      currentSession.id,
      "public",
    ),
  );
  assert.throws(() =>
    service.consistentScans(
      pair.map((s, i) => ({
        ...s,
        capturedAt: new Date(Date.now() + 20000 + i * 1800).toISOString(),
      })),
      currentSession.id,
      "public",
    ),
  );
  const r = await c.request("/api/reports", "POST", {
    binId: null,
    location: [-79.39, 43.65],
    matchMethod: "pin",
    source: "camera",
    issue: "overflowing",
    scanIds: pair.map((s) => s.id),
    idempotencyKey: "unmatched-camera-must-fail",
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /physical bin/);
});
test("idempotency keys cannot return a report from another scope", async () => {
  const c = new Client();
  await c.request("/api/status");
  const input = {
    binId,
    location: [-79.395, 43.655] as [number, number],
    matchMethod: "selected" as const,
    source: "manual" as const,
    issue: "litter",
    scanIds: [],
    note: "",
    idempotencyKey: "same-key-different-scope",
  };
  const saved = await service.createReport(input, await c.session(), "public");
  assert.equal(
    (await service.createReport(input, await c.session(), "public")).report.id,
    saved.report.id,
  );
  await assert.rejects(
    async () =>
      await service.createReport(input, await c.session(), "another-scope"),
    /different reporting area/,
  );
});
test("residents add a photographed bin without management; retries do not duplicate it and evidence stays private", async () => {
  await store.put("area", {
    id: "resident-test",
    name: "Isolated test area",
    scope: "public",
    active: true,
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    createdAt: new Date().toISOString(),
  });
  const c = new Client();
  const image =
    "data:image/jpeg;base64," +
    fs
      .readFileSync("public/images/overflow-bin-hamburg.jpg")
      .toString("base64");
  const input = {
    image,
    location: [0.5, 0.5],
    accuracy: 6,
    locatedAt: new Date().toISOString(),
    idempotencyKey: "resident-add-bin-001",
  };
  const before = (await store.list("bin")).length;
  const first = await c.request("/api/bins/submit", "POST", input);
  assert.equal(first.status, 201);
  assert.equal((await c.session()).admin, false);
  assert.equal(first.data.bin.source, "manual");
  assert.equal(first.data.bin.approval, "approved");
  assert.equal(first.data.bin.mediaId, undefined);
  assert.equal(first.data.bin.sessionId, undefined);
  const retry = await c.request("/api/bins/submit", "POST", input);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.bin.id, first.data.bin.id);
  assert.equal((await store.list("bin")).length, before + 1);
  assert.equal(
    (
      await c.request("/api/bins/submit", "POST", {
        ...input,
        location: [0.6, 0.6],
      })
    ).status,
    409,
  );
  const evidence = (await store.list<any>("bin_evidence")).find(
    (e) => e.binId === first.data.bin.id,
  )!;
  const own = await GET(
    new NextRequest(`http://localhost:3000/api/media/${evidence.mediaId}`, {
      headers: { cookie: c.cookie },
    }),
  );
  assert.equal(own.status, 200);
  assert.equal(own.headers.get("Content-Type"), "image/jpeg");
  assert.equal(
    (await new Client().request(`/api/media/${evidence.mediaId}`)).status,
    403,
  );
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(
    path.join(temp, "media", evidence.mediaId + ".jpg"),
  ).metadata();
  assert.equal(metadata.exif, undefined);
});
test("resident registration rejects absent photos, stale or imprecise GPS, and locations outside designated areas", async () => {
  const c = new Client();
  const image =
    "data:image/jpeg;base64," +
    fs
      .readFileSync("public/images/overflow-bin-hamburg.jpg")
      .toString("base64");
  const input = {
    image,
    location: [0.6, 0.6],
    accuracy: 6,
    locatedAt: new Date().toISOString(),
    idempotencyKey: "resident-rejected-001",
  };
  const before = (await store.list("bin")).length;
  const mediaBefore = fs.readdirSync(path.join(temp, "media")).length;
  for (const change of [
    { image: "" },
    { image: "data:image/jpeg;base64,AAAA" },
    { accuracy: 100 },
    { locatedAt: new Date(Date.now() - 180000).toISOString() },
    { location: [5, 5] },
  ]) {
    const result = await c.request("/api/bins/submit", "POST", {
      ...input,
      ...change,
    });
    assert.equal(result.status, 400);
  }
  assert.equal((await store.list("bin")).length, before);
  assert.equal(fs.readdirSync(path.join(temp, "media")).length, mediaBefore);
});
test("concurrent resident additions and pending-bin conflicts cannot bypass the 15 metre block", async () => {
  const image =
    "data:image/jpeg;base64," +
    fs
      .readFileSync("public/images/overflow-bin-hamburg.jpg")
      .toString("base64");
  const input = {
    image,
    location: [0.7, 0.7],
    accuracy: 6,
    locatedAt: new Date().toISOString(),
    idempotencyKey: "concurrent-bin-001",
  };
  const results = await Promise.all([
    await new Client().request("/api/bins/submit", "POST", input),
    await new Client().request("/api/bins/submit", "POST", input),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const pending = await service.registerBin(
    {
      name: "Test pending bin",
      address: "Isolated test",
      lng: 0.8,
      lat: 0.8,
      areaId: "resident-test",
      status: "Existing",
      approval: "pending",
    },
    "public",
  );
  assert.equal(
    (
      await new Client().request("/api/bins/submit", "POST", {
        ...input,
        location: [pending.lng, pending.lat],
        duplicateExplanation:
          "This text must never override the duplicate block.",
      })
    ).status,
    409,
  );
  await assert.rejects(
    async () =>
      await service.registerBin(
        {
          ...pending,
          duplicateExplanation:
            "This text must never override the duplicate block.",
        },
        "public",
      ),
    /already registered/,
  );
});
test("case review opens anonymously with public details while evidence, identity and changes stay protected", async () => {
  const id = store.uid(),
    reportId = store.uid(),
    mediaId = store.uid();
  const now = new Date().toISOString();
  const c = {
    id,
    scope: "public",
    binId: null,
    state: "observed",
    openedAt: now,
    updatedAt: now,
    owner: "Private operator",
    condition: "unknown",
    location: [-79.3981234, 43.6519876],
    actions: [
      {
        id: store.uid(),
        actor: "Private person",
        type: "observation",
        at: now,
        note: "Private action note",
      },
    ],
  };
  await store.put("case", c);
  const report = {
    id: reportId,
    caseId: id,
    binId: null,
    scope: "public",
    sessionId: "private-session",
    createdAt: now,
    capturedAt: null,
    source: "manual",
    issue: "litter",
    note: "Private landmark detail",
    location: c.location,
    accuracy: 5,
    matchMethod: "pin",
    scanIds: ["private-scan"],
    mediaId,
    status: "active",
    idempotencyKey: "private-key",
    recoveryHash: "private-recovery",
  };
  await store.put("report", report);
  const visitor = new Client();
  const view = await visitor.request(`/api/cases/${id}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.readOnly, true);
  assert.equal(view.data.case.owner, undefined);
  assert.deepEqual(view.data.case.actions, []);
  assert.deepEqual(view.data.case.location, [-79.398, 43.652]);
  assert.equal(view.data.reports[0].note, "");
  for (const field of [
    "sessionId",
    "accuracy",
    "scanIds",
    "mediaId",
    "idempotencyKey",
    "recoveryHash",
  ])
    assert.equal(view.data.reports[0][field], undefined);
  assert.equal((await visitor.request(`/api/media/${mediaId}`)).status, 403);
  assert.equal(
    (
      await visitor.request(`/api/cases/${id}/actions`, "POST", {
        type: "assign",
        owner: "Someone",
        note: "Unauthorized edit",
      })
    ).status,
    401,
  );
  const managed = await manager.request(`/api/cases/${id}`);
  assert.equal(managed.status, 200);
  assert.equal(managed.data.case.owner, "Private operator");
  assert.equal(managed.data.reports[0].mediaId, mediaId);
  await store.put("report", { ...report, status: "withdrawn" });
  assert.equal((await visitor.request(`/api/cases/${id}`)).status, 404);
});
test("manual nearest-bin suggestions are sorted, exclude removed bins, and work beyond the automatic radius", async () => {
  const c = new Client();
  const location = [-79.56, 43.81];
  const r = await c.request(
    `/api/bins/nearby?lng=${location[0]}&lat=${location[1]}&nearest=true`,
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.bins.length, 5);
  assert.ok(
    r.data.bins.every(
      (b: any) => b.status === "Existing" && b.approval === "approved",
    ),
  );
  assert.ok(
    r.data.bins.every(
      (b: any, i: number) =>
        i === 0 || b.distance >= r.data.bins[i - 1].distance,
    ),
  );
  const far = await c.request("/api/bins/nearby?lng=-80&lat=44&nearest=true");
  assert.equal(far.status, 200);
  assert.ok(far.data.bins[0].distance > 500);
  assert.equal(
    (await c.request("/api/bins/nearby?lng=-80&lat=44")).data.bins.length,
    0,
  );
  assert.equal((await c.request("/api/bins/nearby?nearest=true")).status, 400);
  assert.equal(autoMatch(r.data.bins, 100), null);
});
test("bin detail supports manual reports, ownership-specific withdrawal, and community resolution without deleting history", async () => {
  const id = store.uid();
  await store.put("bin", {
    id,
    name: "Isolated lifecycle fixture",
    address: "Lifecycle search address",
    lng: -79.39,
    lat: 43.65,
    source: "manual",
    status: "Existing",
    approval: "approved",
  });
  const reporter = new Client(),
    other = new Client();
  const report = async (client: Client, issue: string) =>
    await client.request("/api/reports", "POST", {
      binId: id,
      location: [-79.39, 43.65],
      matchMethod: "selected",
      source: "manual",
      issue,
      note: "Private note",
      scanIds: [],
      idempotencyKey: store.uid(),
    });
  const first = await report(reporter, "overflowing");
  const second = await report(other, "litter");
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const own = await reporter.request(`/api/bins/${id}`);
  assert.deepEqual(own.data.ownReportIds, [first.data.report.id]);
  assert.deepEqual(
    (await new Client().request(`/api/bins/${id}`)).data.ownReportIds,
    [],
  );
  assert.ok(
    (
      await reporter.request("/api/bins?q=Lifecycle%20search%20address")
    ).data.bins.some((b: any) => b.id === id),
  );
  const caseId = first.data.report.caseId;
  assert.equal(
    (
      await other.request(`/api/bins/${id}/resolve`, "POST", {
        caseIds: [caseId],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await other.request(`/api/bins/${id}/resolve`, "POST", {
        confirmed: true,
        caseIds: [caseId],
      })
    ).status,
    200,
  );
  assert.equal((await store.get<any>("case", caseId)).state, "resolved");
  assert.equal((await store.get<any>("case", caseId)).condition, "clear");
  assert.equal(
    (await store.get<Report>("report", first.data.report.id))!.status,
    "active",
  );
  assert.equal(
    (await service.summary("public", "all")).binCounts[id],
    1,
    "other open issue stays highlighted",
  );
  const actionCount = (await store.get<any>("case", caseId)).actions.length;
  assert.equal(
    (
      await other.request(`/api/bins/${id}/resolve`, "POST", {
        confirmed: true,
        caseIds: [caseId],
      })
    ).status,
    200,
  );
  assert.equal(
    (await store.get<any>("case", caseId)).actions.length,
    actionCount,
    "repeat resolution is idempotent",
  );
  assert.equal(
    (
      await other.request(`/api/bins/${id}/resolve`, "POST", {
        confirmed: true,
        caseIds: [second.data.report.caseId, "missing-case"],
      })
    ).status,
    404,
  );
  assert.notEqual(
    (await store.get<any>("case", second.data.report.caseId)).state,
    "resolved",
    "invalid batch is atomic",
  );
  assert.equal(
    (
      await other.request(`/api/bins/${id}/resolve`, "POST", {
        confirmed: true,
        caseIds: [second.data.report.caseId],
      })
    ).status,
    200,
  );
  const summary = await service.summary("public", "all");
  assert.equal(summary.totalReports, summary.reports.length);
  assert.ok(summary.historicalReports > summary.totalReports);
  assert.equal(summary.binCounts[id], undefined);
  assert.ok(!summary.mapPoints.some((p) => p.binId === id));
  assert.ok(!summary.reports.some((r) => r.id === first.data.report.id));
  assert.equal((await other.request(`/api/bins/${id}`)).data.reports.length, 2);
  assert.ok(
    (await other.request(`/api/bins/${id}`)).data.cases.every(
      (c: any) => c.actions.length === 0 && !c.owner,
    ),
  );
  const recurrence = await report(reporter, "overflowing");
  assert.notEqual(recurrence.data.report.caseId, caseId);
  assert.equal(
    (await store.get<any>("case", recurrence.data.report.caseId)).previousId,
    caseId,
  );
  assert.equal((await service.summary("public", "all")).binCounts[id], 1);
  await other.request(`/api/bins/${id}/resolve`, "POST", {
    confirmed: true,
    caseIds: [caseId],
  });
  assert.equal(
    (await service.summary("public", "all")).binCounts[id],
    1,
    "a stale confirmation never closes a new episode",
  );
  assert.equal(
    (
      await other.request(
        `/api/reports/${recurrence.data.report.id}/withdraw`,
        "POST",
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await reporter.request(
        `/api/reports/${recurrence.data.report.id}/withdraw`,
        "POST",
        {},
      )
    ).status,
    200,
  );
  assert.equal(
    (await service.summary("public", "all")).binCounts[id],
    undefined,
  );
  assert.equal(
    (await reporter.request(`/api/bins/${id}`)).data.reports.length,
    2,
  );
  assert.equal(
    (
      await reporter.request(
        `/api/reports/${first.data.report.id}/withdraw`,
        "POST",
        {},
      )
    ).status,
    200,
  );
  assert.equal(
    (await store.get<any>("case", caseId)).state,
    "resolved",
    "withdrawing a historical report does not undo a completed resolution",
  );
  assert.equal((await store.get<any>("case", caseId)).condition, "clear");
});
test("community resolution refuses foreign-scope cases and withdrawn-only episodes", async () => {
  const b = inventory().find((b) => b.status === "Existing")!;
  const c = new Client();
  const caseId = store.uid();
  const episode = {
    id: caseId,
    binId: b.id,
    scope: "foreign-test",
    state: "observed" as const,
    condition: "overflowing" as const,
    location: [b.lng, b.lat] as [number, number],
    openedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    actions: [],
  };
  await store.put("case", episode);
  assert.equal(
    (
      await c.request(`/api/bins/${b.id}/resolve`, "POST", {
        confirmed: true,
        caseIds: [caseId],
      })
    ).status,
    404,
  );
  await store.put("case", { ...episode, scope: "public" });
  assert.equal(
    (
      await c.request(`/api/bins/${b.id}/resolve`, "POST", {
        confirmed: true,
        caseIds: [caseId],
      })
    ).status,
    409,
  );
  assert.equal((await store.get<any>("case", caseId)).state, "observed");
});
