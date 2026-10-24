import { inventory } from "./inventory";
import {
  get,
  list,
  put,
  uid,
  transaction,
  reportKey,
  saveReportKey,
  secret,
  hash,
} from "./db";
import { assert } from "./auth";
import type { Session } from "./auth";
import type {
  Bin,
  Report,
  Case,
  Scan,
  Summary,
  Area,
  Point,
  MapPoint,
} from "./types";
import { distance, contains, overlap, hashDistance, autoMatch } from "./geo";
import { isCaseOpen } from "./cases";
import { cloudEnabled, pgNearby, pgArea, query } from "./postgres-store";
import { retainMedia } from "./media";
export async function bins(scope = "public", includePending = false) {
  const stored = await list<Bin>("bin", scope);
  return [...(cloudEnabled() ? [] : inventory()), ...stored].filter(
    (b) => includePending || b.approval === "approved",
  );
}
let cityIndex: Map<string, Bin> | undefined;
export async function binById(id: string, scope = "public") {
  if (cloudEnabled()) {
    const bin = await get<Bin>("bin", id);
    return bin &&
      (bin.source === "toronto" ||
        (await query("select scope from public.bins where id=$1", [id]))[0]
          ?.scope === scope)
      ? bin
      : undefined;
  }
  cityIndex ??= new Map(inventory().map((b) => [b.id, b]));
  return (
    cityIndex.get(id) ||
    (await list<Bin>("bin", scope)).find((b) => b.id === id)
  );
}
export async function nearby(point: Point, scope = "public", meters = 200) {
  if (cloudEnabled()) return pgNearby(point, scope, meters);
  return (await bins(scope))
    .filter((b) => b.status === "Existing")
    .map((b) => ({ ...b, distance: distance(point, [b.lng, b.lat]) }))
    .filter((b) => b.distance <= meters)
    .sort((a, b) => a.distance - b.distance);
}
export async function publicReport(r: Report) {
  return {
    id: r.id,
    binName: r.binId ? (await binById(r.binId, r.scope))?.name : undefined,
    caseId: r.caseId,
    caseState: (await get<Case>("case", r.caseId))?.state,
    binId: r.binId,
    scope: r.scope,
    createdAt: r.createdAt,
    capturedAt: r.capturedAt,
    source: r.source,
    issue: r.issue,
    note: "",
    location: (r.binId
      ? r.location
      : r.location.map((n) => Math.round(n * 1000) / 1000)) as Point,
    matchMethod: r.matchMethod,
    status: r.status,
  };
}
export async function publicCase(c: Case) {
  return {
    ...c,
    binName: c.binId ? (await binById(c.binId, c.scope))?.name : undefined,
    owner: undefined,
    location: (c.binId
      ? c.location
      : c.location.map((n) => Math.round(n * 1000) / 1000)) as Point,
    actions: [],
  };
}
export async function summary(scope: string, window = "24h") {
  const since =
    window === "all" ? 0 : Date.now() - (window === "7d" ? 7 : 1) * 86400000;
  const sourceReports = cloudEnabled()
    ? (
        await query<{ data: Report }>(
          "select data from public.reports where scope=$1 and status='active' and created_at >= $2 order by created_at desc",
          [scope, new Date(since).toISOString()],
        )
      ).map((r) => r.data)
    : await list<Report>("report", scope);
  const reports = sourceReports
    .filter((r) => r.status === "active" && Date.parse(r.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ids = new Set(reports.map((r) => r.caseId));
  const sourceCases = cloudEnabled()
    ? (
        await query<{ data: Case }>(
          "select data from public.cases where scope=$1 and id=any($2::text[])",
          [scope, [...ids]],
        )
      ).map((r) => r.data)
    : await list<Case>("case", scope);
  const cases = await Promise.all(
    sourceCases.filter((c) => ids.has(c.id)).map(publicCase),
  );
  const binCounts: Record<string, number> = {};
  const openIds = new Set(
    cases.filter((c) => isCaseOpen(c.state)).map((c) => c.id),
  );
  const openReports = reports.filter((r) => openIds.has(r.caseId));
  for (const r of openReports)
    if (r.binId) binCounts[r.binId] = (binCounts[r.binId] || 0) + 1;
  const mapPoints = Object.values(
    openReports.reduce<Record<string, MapPoint>>((acc, r) => {
      const p = {
        binId: r.binId,
        location: (r.binId
          ? r.location
          : r.location.map((n) => Math.round(n * 1000) / 1000)) as Point,
      };
      const key = p.binId || p.location.join(",");
      if (!acc[key])
        acc[key] = { binId: p.binId, location: p.location, count: 0 };
      acc[key].count++;
      return acc;
    }, {}),
  );
  return {
    mapPoints,
    totalReports: openReports.length,
    historicalReports: reports.length,
    activeCases: openIds.size,
    affectedBins: Object.keys(binCounts).length,
    unmatched: openReports.filter((r) => !r.binId).length,
    reports: await Promise.all(openReports.slice(0, 200).map(publicReport)),
    cases,
    binCounts,
    newest: reports[0]?.createdAt || null,
  };
}
export function consistentScans(
  scans: Scan[],
  sessionId: string,
  scope: string,
  now = Date.now(),
) {
  assert(
    scans.length === 2 && scans[0].id !== scans[1].id,
    400,
    "Two separate camera observations are required.",
  );
  const [a, b] = scans.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  assert(
    scans.every(
      (s) =>
        s.sessionId === sessionId && s.scope === scope && s.method === "camera",
    ),
    403,
    "These observations do not belong to this camera session.",
  );
  assert(
    scans.every(
      (s) =>
        now - Date.parse(s.receivedAt) < 90000 &&
        now - Date.parse(s.capturedAt) < 90000 &&
        Date.parse(s.capturedAt) <= now + 5000 &&
        Date.parse(s.receivedAt) <= now + 5000,
    ),
    400,
    "Camera observations expired. Scan the bin again.",
  );
  const gap = Date.parse(b.capturedAt) - Date.parse(a.capturedAt);
  assert(
    gap >= 700 && gap <= 20000,
    400,
    "Hold the same bin in view for two fresh observations.",
  );
  assert(
    a.frameHash !== b.frameHash,
    400,
    "Two separately captured frames are required.",
  );
  assert(
    scans.every(
      (s) =>
        s.detection.scene === "bin" &&
        s.detection.overflow &&
        s.detection.certainty === "high" &&
        s.detection.box &&
        s.detection.evidence.length > 0 &&
        s.detection.quality.length === 0,
    ),
    400,
    "Overflow was not confirmed in both camera observations.",
  );
  assert(
    overlap(a.detection.box!, b.detection.box!) >= 0.45 &&
      hashDistance(a.perceptualHash, b.perceptualHash) <= 24,
    400,
    "The scene moved. Hold the same bin in view and scan again.",
  );
  return scans;
}
export type CreateReport = {
  binId?: string | null;
  location: Point;
  accuracy?: number | null;
  locatedAt?: string;
  matchMethod: "auto" | "selected" | "pin" | "demo";
  scanIds: string[];
  idempotencyKey: string;
  source: "camera" | "manual" | "upload";
  issue: string;
  note: string;
  capturedAt?: string | null;
  evidenceMediaId?: string;
};
export async function createReport(
  input: CreateReport,
  s: Session,
  scope: string,
) {
  return await transaction(async () => {
    assert(
      !input.capturedAt || Date.parse(input.capturedAt) <= Date.now() + 5000,
      400,
      "Capture time cannot be in the future.",
    );
    const key = await reportKey(s.id, input.idempotencyKey);
    if (key) {
      const previous = await get<Report>("report", key);
      assert(
        previous && previous.scope === scope,
        409,
        "This retry belongs to a different reporting area. Start a new report.",
      );
      return {
        report: await publicReport(previous),
        duplicate: true,
      };
    }
    let bin = input.binId ? await binById(input.binId, scope) : undefined;
    if (scope.startsWith("demo:")) {
      const demo = (await get<{
        binId: string;
      }>("demo", scope.slice(5)))!;
      bin = await binById(demo.binId, scope);
      input = { ...input, matchMethod: "demo" };
    }
    if (input.binId || scope.startsWith("demo:"))
      assert(
        bin && bin.approval === "approved" && bin.status === "Existing",
        400,
        "Choose an active, approved bin.",
      );
    if (input.matchMethod === "auto") {
      assert(
        input.locatedAt &&
          Math.abs(Date.now() - Date.parse(input.locatedAt)) < 30000,
        400,
        "Refresh your location or select the bin.",
      );
      assert(
        scope === "public" &&
          input.accuracy !== null &&
          input.accuracy !== undefined &&
          input.accuracy <= 15,
        400,
        "Location needs confirmation.",
      );
      assert(
        autoMatch(await nearby(input.location, scope), input.accuracy) ===
          bin?.id,
        400,
        "Several bins may match. Select the correct bin.",
      );
    }
    let scans: Scan[] = [];
    if (input.source === "camera")
      assert(
        bin,
        400,
        "Choose the physical bin before saving an automatic report.",
      );
    if (input.source === "camera")
      assert(
        input.issue === "overflowing",
        400,
        "Automatic camera reports only record confirmed overflow.",
      );
    if (input.source === "camera")
      scans = consistentScans(
        await Promise.all(
          input.scanIds.map(async (id) => {
            const scan = await get<Scan>("scan", id);
            assert(scan, 400, "Camera observations expired. Try again.");
            return scan;
          }),
        ),
        s.id,
        scope,
      );
    if (input.source === "upload") {
      assert(
        input.scanIds.length === 1 || input.evidenceMediaId,
        400,
        "Attach a photo or analyze an uploaded photo first.",
      );
      scans = await Promise.all(
        input.scanIds.map(async (id) => {
          const scan = await get<Scan>("scan", id);
          assert(
            scan &&
              scan.sessionId === s.id &&
              scan.scope === scope &&
              scan.method === "upload",
            403,
            "Photo observation unavailable.",
          );
          return scan;
        }),
      );
    }
    const location: Point = bin ? [bin.lng, bin.lat] : input.location;
    const reports = await list<Report>("report", scope);
    if (input.source === "camera") {
      const states = new Map(
        (await list<Case>("case", scope)).map((c) => [c.id, c.state]),
      );
      const duplicate = reports.find(
        (r) =>
          isCaseOpen(states.get(r.caseId)) &&
          r.sessionId === s.id &&
          r.status === "active" &&
          (bin
            ? r.binId === bin.id
            : !r.binId && distance(r.location, location) < 20) &&
          Date.now() - Date.parse(r.createdAt) < 30 * 60000,
      );
      const used = reports.find((r) =>
        r.scanIds.some((id) => input.scanIds.includes(id)),
      );
      const found = used || duplicate;
      if (found) {
        await saveReportKey(s.id, input.idempotencyKey, found.id);
        return { report: await publicReport(found), duplicate: true };
      }
    }
    const episodes = (await list<Case>("case", scope))
      .filter(
        (c) =>
          (c.issue || "overflowing") === input.issue &&
          (bin
            ? c.binId === bin.id
            : !c.binId && distance(c.location, location) < 20),
      )
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const latest = episodes[0];
    let episode =
      latest &&
      isCaseOpen(latest.state) &&
      Date.now() - Date.parse(latest.updatedAt) < 24 * 3600000
        ? latest
        : undefined;
    const now = new Date().toISOString();
    if (!episode)
      episode = {
        id: uid(),
        issue: input.issue,
        binId: bin?.id || null,
        scope,
        state: bin ? "observed" : "needs_review",
        openedAt: now,
        updatedAt: now,
        condition: input.issue === "overflowing" ? "overflowing" : "unknown",
        location,
        actions: [],
        ...(latest ? { previousId: latest.id } : {}),
      };
    const recovery = secret();
    const report: Report = {
      id: uid(),
      caseId: episode.id,
      binId: bin?.id || null,
      scope,
      sessionId: s.id,
      createdAt: now,
      capturedAt:
        input.source === "camera"
          ? scans[0]?.capturedAt || null
          : input.capturedAt || null,
      source: input.source,
      issue: input.issue,
      note: input.note,
      location,
      accuracy: input.accuracy ?? null,
      matchMethod: input.matchMethod,
      scanIds: input.scanIds,
      mediaId: input.evidenceMediaId || scans.at(-1)?.mediaId,
      status: "active",
      idempotencyKey: input.idempotencyKey,
      recoveryHash: hash(recovery),
    };
    episode.updatedAt = now;
    episode.actions.push({
      id: uid(),
      type: "observation",
      at: now,
      actor: "Community observer",
      note:
        input.source === "camera"
          ? "Overflow detected in two camera observations."
          : `Community report: ${input.issue}.`,
    });
    await put("case", episode);
    await put("report", report);
    await retainMedia(report.mediaId);
    await saveReportKey(s.id, input.idempotencyKey, report.id);
    return { report: await publicReport(report), duplicate: false, recovery };
  });
}
export async function registerBin(
  input: Omit<Bin, "id" | "source" | "createdAt"> & {
    duplicateExplanation?: string;
  },
  scope: string,
) {
  const area = await get<Area>("area", input.areaId || "");
  assert(
    area && area.active && area.scope === scope,
    400,
    "Choose an active designated area in this space.",
  );
  assert(
    contains([input.lng, input.lat], area.polygon),
    400,
    "The pin must be inside the selected designated area.",
  );
  const duplicates = await binConflicts([input.lng, input.lat], scope);
  assert(
    !duplicates.length,
    409,
    "A bin is already registered within 15 metres. A second bin cannot be added here.",
  );
  const bin: Bin = {
    ...input,
    id: uid(),
    source: "manual",
    createdAt: new Date().toISOString(),
  };
  await put("bin", bin, scope);
  await put("audit", {
    id: uid(),
    type: "bin_created",
    binId: bin.id,
    at: new Date().toISOString(),
    scope,
    explanation: input.duplicateExplanation || "",
  });
  return bin;
}
export async function binConflicts(point: Point, scope: string) {
  if (cloudEnabled()) return pgNearby(point, scope, 15, true);
  return (await bins(scope, true)).filter(
    (b) => b.approval !== "rejected" && distance(point, [b.lng, b.lat]) <= 15,
  );
}
export type BinEvidence = {
  id: string;
  binId: string;
  mediaId: string;
  sessionId: string;
  scope: string;
  accuracy: number;
  locatedAt: string;
  createdAt: string;
};
export async function createCommunityBin(
  input: {
    location: Point;
    accuracy: number;
    locatedAt: string;
    idempotencyKey: string;
    mediaId: string;
    frameHash: string;
  },
  session: Session,
  scope: string,
) {
  return await transaction(async () => {
    const key = hash(`${session.id}:${input.idempotencyKey}`);
    const fingerprint = hash(JSON.stringify([input.location, input.frameHash]));
    const prior = await get<{
      binId: string;
      fingerprint: string;
      scope: string;
    }>("bin_request", key);
    if (prior) {
      assert(
        prior.scope === scope && prior.fingerprint === fingerprint,
        409,
        "This request was already used for another photo or location.",
      );
      const bin = await binById(prior.binId, scope);
      assert(bin, 409, "This bin is no longer available.");
      return { bin, duplicate: true };
    }
    const age = Date.now() - Date.parse(input.locatedAt);
    assert(
      Number.isFinite(age) && age >= -5000 && age <= 120000,
      400,
      "Your location has expired. Refresh your location and try again.",
    );
    assert(
      input.accuracy <= 25,
      400,
      "Your location is not precise enough. Move outdoors and try again.",
    );
    const area = cloudEnabled()
      ? await pgArea(input.location, scope)
      : (await list<Area>("area", scope)).find(
          (a) => a.active && contains(input.location, a.polygon),
        );
    assert(
      area,
      400,
      "This location is outside the designated areas for adding bins.",
    );
    assert(
      !(await binConflicts(input.location, scope)).length,
      409,
      "A bin is already registered within 15 metres. A second bin cannot be added here.",
    );
    const now = new Date().toISOString();
    const bin: Bin = {
      id: uid(),
      name: `Community bin · ${area.name}`,
      address: area.name,
      lng: input.location[0],
      lat: input.location[1],
      source: "manual",
      status: "Existing",
      approval: "approved",
      areaId: area.id,
      createdAt: now,
    };
    await put("bin", bin, scope);
    await put("bin_evidence", {
      id: uid(),
      binId: bin.id,
      mediaId: input.mediaId,
      sessionId: session.id,
      scope,
      accuracy: input.accuracy,
      locatedAt: input.locatedAt,
      createdAt: now,
    });
    await put("bin_request", { id: key, binId: bin.id, fingerprint, scope });
    await put("audit", {
      id: uid(),
      type: "community_bin_created",
      binId: bin.id,
      at: now,
      scope,
    });
    return { bin, duplicate: false };
  });
}
