import type { Bin } from "./types";

export const REPORT_DRAFT_TTL_MS = 15 * 60 * 1000;
const PREFIX = "bin-there:report-draft:";
const ACTIVE_KEY = `${PREFIX}active`;
const ID = /^[a-z0-9-]{16,80}$/i;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ReportDraft = {
  id: string;
  createdAt: number;
  expiresAt: number;
  image: string;
  capturedAt: string;
  issue: "overflowing";
  initialBin?: Bin;
  note: string;
  scope: string;
  returnTo: string;
};
type DraftInput = {
  image: string;
  capturedAt: string;
  initialBin?: Bin | null;
  note?: string;
  scope?: string;
  returnTo?: string;
};

function safeReturnTo(path?: string) {
  return path &&
    /^\/scan(?:\?camera=off)?$|^\/scan\/test$|^\/demo\/[a-z0-9-]+\/scan(?:\?camera=off)?$/i.test(
      path,
    )
    ? path
    : "/scan?camera=off";
}
function safeScope(scope?: string) {
  return scope && /^demo:[a-z0-9-]+$/i.test(scope) ? scope : "public";
}
function validImage(image: unknown): image is string {
  return (
    typeof image === "string" &&
    image.length <= 8 * 1024 * 1024 &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image)
  );
}
function validBin(bin: unknown): bin is Bin {
  if (!bin || typeof bin !== "object") return false;
  const b = bin as Bin;
  return (
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    typeof b.address === "string" &&
    Number.isFinite(b.lng) &&
    Math.abs(b.lng) <= 180 &&
    Number.isFinite(b.lat) &&
    Math.abs(b.lat) <= 90 &&
    ["toronto", "manual"].includes(b.source) &&
    b.status === "Existing" &&
    b.approval === "approved"
  );
}

// A draft lives only in this browser tab. Navigation carries an opaque ID;
// the image is uploaded by the report form only after explicit submission.
export function createReportDraft(
  input: DraftInput,
  storage?: DraftStorage,
  now = Date.now(),
) {
  if (
    !validImage(input.image) ||
    !Number.isFinite(Date.parse(input.capturedAt))
  )
    throw new Error(
      "This photo could not be prepared for reporting. Retake it and try again.",
    );
  const id = crypto.randomUUID();
  const draft: ReportDraft = {
    id,
    createdAt: now,
    expiresAt: now + REPORT_DRAFT_TTL_MS,
    image: input.image,
    capturedAt: input.capturedAt,
    issue: "overflowing",
    ...(validBin(input.initialBin) ? { initialBin: input.initialBin } : {}),
    note: (input.note || "").slice(0, 1000),
    scope: safeScope(input.scope),
    returnTo: safeReturnTo(input.returnTo),
  };
  let target: DraftStorage | undefined;
  try {
    target = storage ?? window.sessionStorage;
    const previous = target.getItem(ACTIVE_KEY);
    if (previous && ID.test(previous)) target.removeItem(PREFIX + previous);
    target.setItem(PREFIX + id, JSON.stringify(draft));
    target.setItem(ACTIVE_KEY, id);
  } catch {
    try {
      target?.removeItem(PREFIX + id);
    } catch {
      /* Storage may be blocked. */
    }
    throw new Error(
      "This browser could not keep the report photo. Use the report form here or try another browser.",
    );
  }
  return { id, href: `/report?draft=${encodeURIComponent(id)}` };
}

export function removeReportDraft(id: string, storage?: DraftStorage) {
  if (!ID.test(id)) return;
  try {
    const target = storage ?? window.sessionStorage;
    target.removeItem(PREFIX + id);
    if (target.getItem(ACTIVE_KEY) === id) target.removeItem(ACTIVE_KEY);
  } catch {
    /* A blocked browser store cannot retain a usable draft. */
  }
}

export function readReportDraft(
  id: string,
  storage?: DraftStorage,
  now = Date.now(),
): ReportDraft | null {
  if (!ID.test(id)) return null;
  try {
    const target = storage ?? window.sessionStorage;
    const raw = target.getItem(PREFIX + id);
    if (!raw) return null;
    const d = JSON.parse(raw) as ReportDraft;
    if (
      d.id !== id ||
      d.issue !== "overflowing" ||
      !validImage(d.image) ||
      !Number.isFinite(Date.parse(d.capturedAt)) ||
      !Number.isFinite(d.createdAt) ||
      !Number.isFinite(d.expiresAt) ||
      d.createdAt > now + 5000 ||
      d.expiresAt <= now ||
      d.expiresAt - d.createdAt !== REPORT_DRAFT_TTL_MS
    ) {
      removeReportDraft(id, target);
      return null;
    }
    return {
      ...d,
      initialBin: validBin(d.initialBin) ? d.initialBin : undefined,
      note: typeof d.note === "string" ? d.note.slice(0, 1000) : "",
      scope: safeScope(d.scope),
      returnTo: safeReturnTo(d.returnTo),
    };
  } catch {
    removeReportDraft(id, storage);
    return null;
  }
}
