import type { Box, Guidance } from "./types";

export type Rect = { left: number; top: number; width: number; height: number };
// Preserve the main scanner's evidence window. The separate cloud preview
// enforces a two-second live-coordinate limit and uses a matching still after it.
export const LIVE_FRAME_MAX_AGE_MS = 12_000;
export const OVERLAY_LIFETIME_MS = 1_000;
export const SCENE_CHANGE_THRESHOLD = 22;

// Full-image previews use contain; the live camera uses the matching cover crop below.
export function containedFrame(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): Rect {
  if (
    ![width, height, sourceWidth, sourceHeight].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale,
    h = sourceHeight * scale;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

// Source-pixel crop corresponding to a centered CSS object-fit: cover viewport.
export function cameraCrop(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): Rect {
  if (
    ![width, height, sourceWidth, sourceHeight].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const w = width / scale,
    h = height / scale;
  return {
    left: (sourceWidth - w) / 2,
    top: (sourceHeight - h) / 2,
    width: w,
    height: h,
  };
}

export function sceneDifference(
  a?: ArrayLike<number> | null,
  b?: ArrayLike<number> | null,
) {
  if (!a?.length || !b || a.length !== b.length || a.length % 4)
    return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i += 4)
    total +=
      (Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2])) /
      3;
  return total / (a.length / 4);
}

export function liveResultUsable(
  capturedAt: number,
  now: number,
  changed: boolean,
  difference: number,
) {
  return (
    !changed &&
    now >= capturedAt &&
    now - capturedAt <= LIVE_FRAME_MAX_AGE_MS &&
    difference <= SCENE_CHANGE_THRESHOLD
  );
}

function intersection(a: Rect, b: Rect) {
  return (
    Math.max(
      0,
      Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
    ) *
    Math.max(
      0,
      Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
    )
  );
}
const clamp = (v: number, low: number, high: number) =>
  Math.max(low, Math.min(high, v));
export const streamLabel = (stream: Guidance["stream"]) =>
  ({
    recycling: "Recycling",
    organics: "Organics",
    garbage: "Garbage / litter",
    check: "Not identified",
  })[stream];

export function guidanceLabel(item: Guidance) {
  if (item.action === "reuse") return "Keep & reuse";
  if (item.source === "project:straw-sorting" && item.stream === "garbage")
    return "Litter";
  if (
    item.stream === "check" &&
    /battery|lithium|medical sharp|needle|mercury/i.test(item.material || "")
  )
    return "Special collection";
  if (
    item.stream === "recycling" &&
    /paper|cardboard|boxboard|fibre|fiber/i.test(item.material || "") &&
    !/glass|metal|alumin|steel/i.test(item.material || "")
  )
    return "Paper · recycling";
  return streamLabel(item.stream);
}

export function guidanceSourceUrl(source: string) {
  return source === "https://www.toronto.ca/data/swms/wastewizard/data.json"
    ? "https://www.toronto.ca/services-payments/recycling-organics-garbage/waste-wizard/"
    : source;
}

export type Callout = Rect & {
  index: number;
  item: Guidance;
  anchor: { x: number; y: number };
  start: { x: number; y: number };
};

// Keep a few readable callouts in the image, with leaders to their actual part.
// More components remain in the numbered list below the camera.
export function layoutCallouts(
  items: Guidance[],
  width: number,
  height: number,
): Callout[] {
  if (width < 140 || height < 80) return [];
  const margin = 8,
    labelWidth = Math.min(154, width * 0.45),
    labelHeight = 62;
  const projected = (b: Box): Rect => ({
    left: b.x * width,
    top: b.y * height,
    width: b.width * width,
    height: b.height * height,
  });
  const boxes = items.filter((t) => t.box).map((t) => projected(t.box!));
  const placed: Callout[] = [];
  for (const [index, item] of items.entries()) {
    if (!item.box || placed.length === 3) continue;
    const anchor = {
      x: clamp((item.box.x + item.box.width / 2) * width, 0, width),
      y: clamp((item.box.y + item.box.height / 2) * height, 0, height),
    };
    const candidates: Rect[] = [];
    for (const left of [margin, width - labelWidth - margin]) {
      for (const top of [
        clamp(
          anchor.y - labelHeight / 2,
          margin,
          height - labelHeight - margin,
        ),
        ...Array.from(
          {
            length: Math.max(
              1,
              Math.floor((height - margin * 2) / (labelHeight + 8)),
            ),
          },
          (_, i) => margin + i * (labelHeight + 8),
        ),
      ])
        candidates.push({ left, top, width: labelWidth, height: labelHeight });
    }
    const ranked = candidates
      .filter(
        (c) =>
          !placed.some(
            (p) =>
              intersection(
                {
                  ...c,
                  left: c.left - 3,
                  top: c.top - 3,
                  width: c.width + 6,
                  height: c.height + 6,
                },
                p,
              ) > 0,
          ),
      )
      .map((c) => ({
        c,
        score:
          boxes.reduce((sum, b) => sum + intersection(c, b), 0) * 5 +
          Math.hypot(
            c.left + c.width / 2 - anchor.x,
            c.top + c.height / 2 - anchor.y,
          ),
      }))
      .sort((a, b) => a.score - b.score);
    const rect = ranked[0]?.c;
    if (!rect) continue;
    const start = {
      x: clamp(anchor.x, rect.left, rect.left + rect.width),
      y: clamp(anchor.y, rect.top, rect.top + rect.height),
    };
    placed.push({ ...rect, index, item, anchor, start });
  }
  return placed;
}
