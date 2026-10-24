import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Bin } from "./types";
export const SOURCE_URL =
  "https://open.toronto.ca/dataset/street-furniture-litter-receptacle/";
export const RAW_FILE =
  "Street furniture-Litter receptacle data - 4326.geojson";
export function stableId(sourceId: string) {
  const h = createHash("sha256")
    .update("toronto:" + sourceId)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
let cache: Bin[] | undefined;
export function inventory(): Bin[] {
  if (cache) return cache;
  const bytes = fs.readFileSync(path.join(process.cwd(), RAW_FILE));
  const version = createHash("sha256").update(bytes).digest("hex");
  const raw = JSON.parse(bytes.toString("utf8"));
  const clean = (v: unknown) =>
    typeof v === "string" && v !== "None" ? v.trim() : "";
  cache = raw.features.map(
    (f: {
      properties: Record<string, unknown>;
      geometry: { coordinates: number[][] };
    }) => {
      const p = f.properties,
        [lng, lat] = f.geometry.coordinates[0];
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !p.ID)
        throw new Error("Invalid inventory record");
      const address = [
        clean(p.ADDRESSNUMBERTEXT),
        clean(p.ADDRESSSTREET) || clean(p.FRONTINGSTREET),
      ]
        .filter(Boolean)
        .join(" ");
      return {
        id: stableId(String(p.ID)),
        sourceId: String(p.ID),
        sourceUrl: SOURCE_URL,
        sourceVersion: version,
        sourceAttributes: Object.fromEntries(
          Object.entries(p).map(([k, v]) => [k, v === "None" ? null : v]),
        ),
        name: address || String(p.ID),
        address,
        side: clean(p.SIDE),
        ward: clean(p.WARD),
        lng,
        lat,
        source: "toronto",
        status: p.STATUS === "Existing" ? "Existing" : "Temporarily Removed",
        approval: "approved",
      };
    },
  );
  if (new Set(cache!.map((b) => b.id)).size !== cache!.length)
    throw new Error("Duplicate City asset IDs");
  return cache!;
}
