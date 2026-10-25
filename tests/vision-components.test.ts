import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProviderDetection, visionThinkingLevel } from "../lib/vision";

const cup = {
  s: "item",
  t: "Paper cup",
  c: "high",
  o: false,
  e: [],
  b: [100, 200, 900, 800],
  q: [],
  m: "Cup with visible parts.",
  p: [
    {
      l: "Cup body",
      i: "paper_cup",
      m: "paper",
      c: "high",
      b: [300, 200, 900, 800],
    },
    {
      l: "Lid",
      i: "cup_lid",
      m: "unknown",
      c: "high",
      b: [250, 150, 320, 850],
    },
    {
      l: "Straw",
      i: "straw",
      m: "unknown",
      c: "high",
      b: [100, 400, 400, 405],
    },
  ],
};

test("compact Gemini parts retain separate boxes, including a genuinely thin straw", () => {
  const result = normalizeProviderDetection(cup);
  assert.deepEqual(
    result.components.map((c) => c.item),
    ["paper_cup", "cup_lid", "straw"],
  );
  assert.ok(
    result.components[2].box.width > 0 && result.components[2].box.width < 0.01,
  );
  assert.equal(result.components[1].material, "unknown");
  assert.equal(result.overflow, false);
});

test("compact responses still reject invalid geometry and unsupported catalog items", () => {
  assert.throws(() =>
    normalizeProviderDetection({
      ...cup,
      p: [{ ...cup.p[0], b: [400, 400, 300, 300] }],
    }),
  );
  assert.throws(() =>
    normalizeProviderDetection({
      ...cup,
      p: [{ ...cup.p[0], i: "invented_stream" }],
    }),
  );
  const uncertain = normalizeProviderDetection({ ...cup, c: "low", o: true });
  assert.equal(uncertain.overflow, false);
  assert.ok(uncertain.components.every((c) => c.certainty === "low"));
});

test("the provider catalog preserves tissue and disposable container identities for local sorting", () => {
  const result = normalizeProviderDetection({
    ...cup,
    p: [
      { ...cup.p[0], l: "Napkin", i: "tissue", m: "paper" },
      { ...cup.p[0], l: "Takeout tub", i: "plastic_container", m: "plastic" },
    ],
  });
  assert.deepEqual(
    result.components.map((c) => c.item),
    ["tissue", "plastic_container"],
  );
});

test("minimal thinking is used only by models documented to support it", () => {
  assert.equal(visionThinkingLevel("gemini-3.6-flash"), "minimal");
  assert.equal(visionThinkingLevel("gemini-3.5-flash-lite"), "minimal");
  assert.equal(visionThinkingLevel("gemini-3.8-flash"), "low");
});
