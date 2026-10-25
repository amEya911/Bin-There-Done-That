import test from "node:test";
import assert from "node:assert/strict";
import { letterbox, decodeYolo, decodeRfDetr, nms, track, percentile, COCO_NAMES, COCO_IDS } from "../public/vision/core.mjs";

test("YOLO removes its letterbox padding instead of drawing boxes in the wrong image area", () => {
  const data = new Float32Array(84 * 2);
  // A box spanning the complete 1280x640 photo, letterboxed into 640x640.
  data[0] = 320; data[2] = 320; data[4] = 640; data[6] = 320;
  data[(41 + 4) * 2] = .9;
  const found = decodeYolo({ dims: [1, 84, 2], data }, 1280, 640, 640);
  assert.equal(found.length, 1); assert.equal(found[0].label, "cup");
  assert.deepEqual(found[0].box, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(letterbox(640, 1280, 640), { width: 320, height: 640, left: 160, top: 0, scaleX: .5, scaleY: .5 });
});

test("RF-DETR decodes sparse foreground ID90, not a presumed background slot", () => {
  const logits = new Float32Array(91).fill(-20); logits[90] = 5;
  const found = decodeRfDetr({ dims: [1, 1, 4], data: new Float32Array([.5, .5, .2, .4]) }, { dims: [1, 1, 91], data: logits });
  assert.equal(found[0].label, "toothbrush");
  assert.ok(Math.abs(found[0].box.x - .4) < .00001);
  assert.ok(found[0].score > .99);
  // Slot 12 is an unused COCO ID. It must never become a label.
  logits.fill(-20); logits[12] = 20;
  assert.equal(decodeRfDetr({ dims: [1, 1, 4], data: new Float32Array([.5, .5, .2, .4]) }, { dims: [1, 1, 91], data: logits }).length, 0);
  assert.equal(COCO_NAMES.length, 80); assert.equal(COCO_IDS.length, 80);
});

test("a trained waste checkpoint uses its own class names rather than COCO IDs", () => {
  const names = ["paper_cup", "bottle_cap", "app_waste_bin"];
  const data = new Float32Array([256, 256, 128, 128, .05, .92, .03]);
  const found = decodeYolo({ dims: [1, 7, 1], data }, 512, 512, 512, .4, names);
  assert.equal(found.length, 1);
  assert.equal(found[0].label, "bottle_cap");
  assert.deepEqual(found[0].box, { x: .375, y: .375, width: .25, height: .25 });
  assert.throws(() => decodeYolo({ dims: [1, 7, 1], data }, 512, 512, 512, .4, ["one", "two"]));
  assert.throws(() => decodeYolo({ dims: [1, 7, 1], data }, 512, 512, 512, .4, ["same", "same", "third"]));
});

test("overlapping parts of different classes survive NMS; duplicate same-class boxes do not", () => {
  const box = { x: .1, y: .2, width: .3, height: .4 };
  const found = nms([{ label: "cup", score: .8, box }, { label: "cup", score: .9, box }, { label: "bottle", score: .7, box }]);
  assert.deepEqual(found.map(x => x.label), ["cup", "bottle"]);
});

test("tracking retains identity but removes absent objects immediately", () => {
  const d = { label: "cup", score: .9, box: { x: .1, y: .2, width: .3, height: .4 } };
  const first = track([], [d]);
  const next = track(first.tracks, [{ ...d, box: { ...d.box, x: .12 } }], first.nextId);
  assert.equal(next.tracks[0].id, first.tracks[0].id);
  assert.ok(next.tracks[0].box.x > .1 && next.tracks[0].box.x < .12);
  assert.deepEqual(track(next.tracks, [], next.nextId).tracks, []);
});

test("bad model shapes fail explicitly; p95 does not average away slow frames", () => {
  assert.throws(() => decodeYolo({ dims: [1, 300, 6], data: [] }, 640, 640, 640));
  assert.equal(percentile([], .95), null);
  assert.equal(percentile([...Array(18).fill(100), 2100, 3000], .95), 2100);
});
