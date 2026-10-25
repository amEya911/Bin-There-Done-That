import test from "node:test";
import assert from "node:assert/strict";
import {
  guidance,
  VISION_ITEM_IDS,
  RULE_SOURCE,
  WASTE_WIZARD_DATA_SOURCE,
  PROJECT_STRAW_SOURCE,
} from "../lib/rules";
import type { ComponentDetection } from "../lib/types";
import { guidanceLabel } from "../lib/ar";

function component(
  item: string,
  material: string,
  certainty: ComponentDetection["certainty"] = "high",
  materialBasis: ComponentDetection["materialBasis"] = "estimated",
): ComponentDetection {
  return {
    label: item,
    item,
    material,
    certainty,
    materialBasis,
    box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 },
  };
}

test("recognized cup parts receive separate practical directions with estimated materials", () => {
  const parts = [
    component("paper_cup", "paper"),
    component("cup_lid", "unknown"),
    component("straw", "plastic"),
    component("cup_sleeve", "cardboard"),
  ].map((part, index) => ({ ...part, box: { ...part.box, x: index * 0.2 } }));
  const result = guidance(parts);
  assert.deepEqual(
    result.map((g) => g.stream),
    ["recycling", "recycling", "garbage", "recycling"],
  );
  assert.ok(result.every((g) => g.estimated));
  assert.deepEqual(
    result.map((g) => g.box),
    parts.map((p) => p.box),
  );
  assert.equal(result[0].source, RULE_SOURCE);
  assert.match(result[0].instruction, /Empty liquids/);
  assert.match(result[1].instruction, /Remove this disposable lid/);
  assert.ok(result.every((g) => !/check material/i.test(g.instruction)));
});

test("medium-confidence recognizable parts get direct guidance with estimated composition retained", () => {
  const parts = [
    component("paper_cup", "paper", "medium"),
    component("cup_lid", "plastic", "medium"),
    component("cup_sleeve", "unknown", "medium"),
  ];
  assert.ok(
    guidance(parts).every((g) => g.stream === "recycling" && g.estimated),
  );
  assert.equal(
    guidance([component("paper_cup", "paper", "high", "observed")])[0]
      .estimated,
    false,
  );
});

test("paper recycling stays distinct from tissues and food-soiled uncoated paper", () => {
  const result = guidance([
    component("paper", "paper"),
    component("cardboard", "cardboard"),
    component("tissue", "paper tissue"),
    component("paper", "food-soiled uncoated paper"),
    component("cardboard", "greasy cardboard pizza box"),
    component("tissue", "paper towel soiled with cleaning product"),
  ]);
  assert.deepEqual(
    result.map((g) => g.stream),
    ["recycling", "recycling", "organics", "organics", "organics", "garbage"],
  );
  assert.deepEqual(result.map(guidanceLabel), [
    "Paper · recycling",
    "Paper · recycling",
    "Organics",
    "Organics",
    "Organics",
    "Garbage / litter",
  ]);
  assert.match(result[2].instruction, /Keep it out of paper recycling/);
  assert.match(result[3].instruction, /If none is available/);
  assert.equal(
    guidanceLabel(guidance([component("cup_sleeve", "unknown")])[0]),
    "Paper · recycling",
  );
  assert.equal(
    guidance([component("tissue", "biodegradable paper")])[0].stream,
    "organics",
  );
  assert.equal(
    guidance([component("food", "compostable organic food")])[0].stream,
    "organics",
  );
});

test("disposable plastic food containers recycle after emptying while reusable or compostable ones do not", () => {
  const result = guidance([
    component("plastic_container", "plastic"),
    component("plastic_container", "reusable plastic"),
    component("plastic_container", "compostable plastic"),
    component("plastic_container", "glass"),
  ]);
  assert.deepEqual(
    result.map((g) => g.stream),
    ["recycling", "check", "garbage", "check"],
  );
  assert.match(result[0].instruction, /rinse off residue/);
  assert.equal(result[1].action, "reuse");
  assert.ok((VISION_ITEM_IDS as readonly string[]).includes("tissue"));
  assert.ok(
    (VISION_ITEM_IDS as readonly string[]).includes("plastic_container"),
  );
});

test("project straw policy uses litter for plastic and paper recycling for paper", () => {
  const result = guidance([
    component("straw", "plastic"),
    component("straw", "paper with plastic lining"),
    component("straw", "unlined paper", "high", "observed"),
    component("straw", "paper"),
    component("straw", "biodegradable unlined paper"),
  ]);
  assert.deepEqual(
    result.map((g) => g.stream),
    ["garbage", "recycling", "recycling", "recycling", "recycling"],
  );
  assert.deepEqual(result.map(guidanceLabel), [
    "Litter",
    "Paper · recycling",
    "Paper · recycling",
    "Paper · recycling",
    "Paper · recycling",
  ]);
  assert.ok(result.every((g) => g.source === PROJECT_STRAW_SOURCE));
  assert.ok(result.every((g) => g.source !== WASTE_WIZARD_DATA_SOURCE));
  assert.equal(result[2].estimated, false);
  assert.equal(result[3].estimated, true);
});

test("plastic and unknown straws use litter while paper variants never become organics", () => {
  const result = guidance([
    component("straw", "transparent plastic"),
    component("straw", "paper"),
    component("straw", "paper", "high", "observed"),
    component("straw", "unknown"),
    component("straw", "unlined paper, lining not confirmed"),
    component("straw", "unlined paper with plastic coating"),
    component("straw", "unlined paper with wax lining"),
    component("straw", "paper without wax/plastic lining"),
    component("straw", "100% paper"),
    component("straw", "plastic-free paper"),
  ]);
  assert.deepEqual(
    result.map((g) => g.stream),
    [
      "garbage",
      "recycling",
      "recycling",
      "garbage",
      "recycling",
      "recycling",
      "recycling",
      "recycling",
      "recycling",
      "recycling",
    ],
  );
  assert.equal(guidanceLabel(result[0]), "Litter");
  assert.equal(guidanceLabel(result[3]), "Litter");
  assert.ok(result[0].instruction.includes("litter"));
  assert.equal(result[0].estimated, true);
  assert.equal(result[1].estimated, true);
});

test("the straw override leaves reusable parts and other item sources intact", () => {
  const reusable = guidance([
    component("straw", "stainless steel"),
    component("straw", "glass"),
    component("straw", "reusable plastic"),
  ]);
  assert.ok(reusable.every((g) => g.action === "reuse"));
  assert.ok(reusable.every((g) => g.source !== PROJECT_STRAW_SOURCE));
  const [lid, sleeve, bottle, compostableLid, compostableStraw] = guidance([
    component("cup_lid", "plastic"),
    component("cup_sleeve", "paper"),
    component("plastic_bottle", "plastic"),
    component("cup_lid", "compostable plastic"),
    component("straw", "compostable plastic"),
  ]);
  assert.deepEqual(
    [lid, sleeve, bottle, compostableLid].map((g) => g.stream),
    ["recycling", "recycling", "recycling", "garbage"],
  );
  assert.ok(
    [lid, sleeve, bottle, compostableLid].every(
      (g) => g.source !== PROJECT_STRAW_SOURCE,
    ),
  );
  assert.equal(compostableLid.source, WASTE_WIZARD_DATA_SOURCE);
  assert.equal(guidanceLabel(compostableStraw), "Litter");
});

test("educated guesses do not throw away reusables or recycle compostable plastic", () => {
  const reusable = guidance([
    component("straw", "stainless steel"),
    component("cup_sleeve", "silicone"),
    component("unknown", "reusable plastic"),
  ]);
  assert.ok(
    reusable.every(
      (g) => g.action === "reuse" && /Keep and reuse/.test(g.instruction),
    ),
  );
  assert.equal(
    guidance([component("cup_lid", "compostable plastic")])[0].stream,
    "garbage",
  );
  const unknown = guidance([
    component("unknown", "unknown"),
    component("paper_cup", "paper", "low"),
    component("paper_cup", "plastic"),
  ]);
  assert.ok(
    unknown.every(
      (g) => g.stream === "check" && /Reposition/.test(g.instruction),
    ),
  );
});

test("bottle caps stay with empty plastic bottles and provider IDs include every component", () => {
  for (const id of [
    "cup_lid",
    "straw",
    "cup_sleeve",
    "bottle_cap",
    "cardboard",
    "glass_bottle",
    "unknown",
  ])
    assert.ok((VISION_ITEM_IDS as readonly string[]).includes(id));
  assert.equal(new Set(VISION_ITEM_IDS).size, VISION_ITEM_IDS.length);
  const cap = guidance([component("bottle_cap", "plastic")])[0];
  assert.equal(cap.stream, "recycling");
  assert.match(cap.instruction, /on its empty plastic bottle/);
});
