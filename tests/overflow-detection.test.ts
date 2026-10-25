import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProviderDetection } from "../lib/vision";

const overflow = {
  s: "bin",
  t: "Overflowing street bin",
  c: "high",
  o: true,
  u: true,
  e: ["Takeout containers piled above the rim"],
  b: [200, 150, 900, 650],
  q: [],
  m: "Waste is piled above the opening.",
  p: [],
};

test("assessable photographed overflow survives a harmless display-quality note", () => {
  const result = normalizeProviderDetection({
    ...overflow,
    q: ["Minor screen moire outside the bin"],
  });
  assert.equal(result.overflow, true);
  assert.deepEqual(result.evidence, overflow.e);
  assert.deepEqual(result.quality, ["Minor screen moire outside the bin"]);
});

test("medium scene certainty retains visible overflow for human report confirmation", () => {
  const result = normalizeProviderDetection({ ...overflow, c: "medium" });
  assert.equal(result.overflow, true);
  assert.equal(result.certainty, "medium");
});

test("unusable, unsupported and unrelated observations cannot claim overflow", () => {
  for (const changes of [
    { u: false, q: ["The opening is fully hidden behind an obstruction"] },
    { c: "low" },
    { e: [] },
    { e: ["  "] },
    { b: null },
    { s: "item" },
    { s: "unrelated" },
    { o: false },
  ])
    assert.equal(
      normalizeProviderDetection({ ...overflow, ...changes }).overflow,
      false,
    );
});

test("legacy quality notes stay conservative without an explicit usable assessment", () => {
  const { u, ...legacy } = overflow;
  assert.equal(normalizeProviderDetection(legacy).overflow, true);
  assert.equal(
    normalizeProviderDetection({ ...legacy, q: ["Blurred opening"] }).overflow,
    false,
  );
});

test("an unusable item view cannot retain confident disposable-component advice", () => {
  const result = normalizeProviderDetection({
    ...overflow,
    s: "item",
    u: false,
    p: [
      {
        l: "Cup",
        i: "paper_cup",
        m: "paper",
        c: "high",
        b: [200, 150, 900, 650],
      },
    ],
  });
  assert.equal(result.overflow, false);
  assert.equal(result.components[0].certainty, "low");
});
