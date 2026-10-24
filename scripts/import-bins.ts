import fs from "node:fs";
import { createHash } from "node:crypto";
import { inventory, RAW_FILE, SOURCE_URL } from "../lib/inventory";
const bins = inventory();
fs.mkdirSync("public/data", { recursive: true });
const data = {
  type: "FeatureCollection",
  features: bins
    .filter((b) => b.status === "Existing")
    .map((b) => ({
      type: "Feature",
      id: b.id,
      geometry: { type: "Point", coordinates: [b.lng, b.lat] },
      properties: {
        id: b.id,
        name: b.name,
        source: "toronto",
        sourceId: b.sourceId,
        ward: b.ward,
      },
    })),
};
fs.writeFileSync("public/data/toronto-bins.geojson", JSON.stringify(data));
fs.writeFileSync(
  "public/data/inventory-manifest.json",
  JSON.stringify(
    {
      source: SOURCE_URL,
      importedAt: new Date().toISOString(),
      sha256: createHash("sha256")
        .update(fs.readFileSync(RAW_FILE))
        .digest("hex"),
      total: bins.length,
      active: bins.filter((b) => b.status === "Existing").length,
      removed: bins.filter((b) => b.status !== "Existing").length,
    },
    null,
    2,
  ),
);
console.log(
  `Validated ${bins.length} unique City IDs; published ${data.features.length} active points. Original GeoJSON preserved.`,
);
