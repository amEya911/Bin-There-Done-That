import type { Point } from "./types";
export function distance(a: Point, b: Point) {
  const r = Math.PI / 180,
    dlat = (b[1] - a[1]) * r,
    dlng = (b[0] - a[0]) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function contains(p: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i],
      cross = (p[1] - a[1]) * (b[0] - a[0]) - (p[0] - a[0]) * (b[1] - a[1]);
    if (
      Math.abs(cross) < 1e-10 &&
      p[0] >= Math.min(a[0], b[0]) - 1e-10 &&
      p[0] <= Math.max(a[0], b[0]) + 1e-10 &&
      p[1] >= Math.min(a[1], b[1]) - 1e-10 &&
      p[1] <= Math.max(a[1], b[1]) + 1e-10
    )
      return true;
    if (
      b[1] > p[1] !== a[1] > p[1] &&
      p[0] < ((a[0] - b[0]) * (p[1] - b[1])) / (a[1] - b[1]) + b[0]
    )
      inside = !inside;
  }
  return inside;
}
export function validPolygon(r: Point[]) {
  if (
    r.length < 4 ||
    r.length > 200 ||
    r.some(
      (p) =>
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90,
    )
  )
    return false;
  if (r[0][0] !== r.at(-1)![0] || r[0][1] !== r.at(-1)![1]) return false;
  const orient = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < r.length - 1; i++)
    for (let j = i + 2; j < r.length - 1; j++) {
      if (i === 0 && j === r.length - 2) continue;
      if (
        orient(r[i], r[i + 1], r[j]) * orient(r[i], r[i + 1], r[j + 1]) <= 0 &&
        orient(r[j], r[j + 1], r[i]) * orient(r[j], r[j + 1], r[i + 1]) <= 0
      )
        return false;
    }
  return (
    Math.abs(
      r
        .slice(0, -1)
        .reduce((s, a, i) => s + a[0] * r[i + 1][1] - r[i + 1][0] * a[1], 0),
    ) > 1e-10
  );
}
export function autoMatch(
  candidates: { id: string; distance: number }[],
  accuracy: number,
) {
  return accuracy <= 15 &&
    candidates[0]?.distance <= 25 &&
    (!candidates[1] || candidates[1].distance > 50)
    ? candidates[0].id
    : null;
}
export function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const w = Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    ),
    h = Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    );
  return (w * h) / (a.width * a.height + b.width * b.height - w * h || 1);
}
export function hashDistance(a: string, b: string) {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}
