import test from "node:test";
import assert from "node:assert/strict";
import { localPreview } from "../lib/local-preview";

test("local waste arrows retain each part's location and require material checks", () => {
  const box = { x: .1, y: .2, width: .3, height: .4 };
  const cap = { x: .2, y: .1, width: .05, height: .04 };
  const result = localPreview([{ label: "paper_cup", score: .95, box }, { label: "plastic_bottle_cap", score: .9, box: cap }], [{ name: "paper_cup", canonicalSuggestion: "cup_body" }, { name: "plastic_bottle_cap", canonicalSuggestion: "bottle_cap" }]);
  assert.deepEqual(result.guidance.map(g => g.box), [box, cap]);
  assert.ok(result.guidance.every(g => g.stream === "check"));
  assert.ok(result.detection.components.every(c => c.material === "unknown" && c.item === "unknown"));
  assert.equal(result.detection.overflow, false);
});

test("a local bin detection never establishes overflow or creates sorting guidance", () => {
  const result = localPreview([{ label: "app_waste_bin", score: .99, box: { x: .2, y: .1, width: .5, height: .8 } }]);
  assert.equal(result.detection.scene, "bin");
  assert.equal(result.detection.overflow, false);
  assert.equal(result.detection.certainty, "low");
  assert.deepEqual(result.guidance, []);
});
