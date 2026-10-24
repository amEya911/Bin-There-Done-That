import { test } from "node:test";
import assert from "node:assert/strict";
import {
  containedFrame,
  cameraCrop,
  layoutCallouts,
  liveResultUsable,
  sceneDifference,
  LIVE_FRAME_MAX_AGE_MS,
} from "../lib/ar";
import type { Guidance } from "../lib/types";

test("camera boxes map to the contained image in portrait and landscape, excluding bars", () => {
  assert.deepEqual(containedFrame(390, 520, 1280, 960), {
    left: 0,
    top: 113.75,
    width: 390,
    height: 292.5,
  });
  assert.deepEqual(containedFrame(800, 450, 960, 1280), {
    left: 231.25,
    top: 0,
    width: 337.5,
    height: 450,
  });
  assert.equal(containedFrame(390, 520, 0, 0).width, 0);
  assert.equal(containedFrame(Infinity, 520, 640, 480).width, 0);
});

test("a late result cannot become live guidance after movement, even if the camera returns to the original view", () => {
  const a = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]);
  const b = new Uint8ClampedArray([70, 70, 70, 255, 80, 80, 80, 255]);
  assert.equal(sceneDifference(a, a), 0);
  assert.equal(sceneDifference(a, b), 60);
  assert.equal(sceneDifference(a, null), Infinity);
  assert.equal(liveResultUsable(1000, 2000, false, 0), true);
  assert.equal(liveResultUsable(1000, 2000, true, 0), false);
  assert.equal(liveResultUsable(1000, 2000, false, 60), false);
  assert.equal(
    liveResultUsable(1000, 1001 + LIVE_FRAME_MAX_AGE_MS, false, 0),
    false,
  );
  assert.equal(liveResultUsable(2000, 1000, false, 0), false);
});

test("crowded component labels stay in the image, avoid each other, and retain their own anchors", () => {
  const items: Guidance[] = Array.from({ length: 8 }, (_, i) => ({
    label: `Component ${i + 1}`,
    stream: i ? "check" : "recycling",
    instruction: "Test layout only",
    source: "https://www.toronto.ca/",
    reviewed: "2026-10-22",
    box: { x: 0.4, y: 0.2 + i * 0.03, width: 0.2, height: 0.1 },
  }));
  for (const [width, height] of [
    [340, 420],
    [700, 380],
    [160, 100],
  ]) {
    const labels = layoutCallouts(items, width, height);
    assert.ok(labels.length > 0 && labels.length <= 3);
    for (const c of labels) {
      assert.ok(c.left >= 0 && c.top >= 0);
      assert.ok(c.left + c.width <= width && c.top + c.height <= height);
      assert.equal(
        c.anchor.x,
        (items[c.index].box!.x + items[c.index].box!.width / 2) * width,
      );
      assert.equal(
        c.anchor.y,
        (items[c.index].box!.y + items[c.index].box!.height / 2) * height,
      );
      for (const other of labels.filter((o) => o.index !== c.index))
        assert.ok(
          c.left + c.width <= other.left ||
            other.left + other.width <= c.left ||
            c.top + c.height <= other.top ||
            other.top + other.height <= c.top,
        );
    }
  }
});

test("the live cover crop fills portrait and landscape frames and keeps visible detections aligned", () => {
  assert.deepEqual(cameraCrop(300, 600, 800, 600), {
    left: 250,
    top: 0,
    width: 300,
    height: 600,
  });
  assert.deepEqual(cameraCrop(800, 400, 600, 800), {
    left: 0,
    top: 250,
    width: 600,
    height: 300,
  });
  for (const [width, height, sw, sh] of [
    [390, 660, 960, 1280],
    [390, 660, 1280, 720],
    [1440, 700, 960, 1280],
  ]) {
    const c = cameraCrop(width, height, sw, sh);
    const scale = Math.max(width / sw, height / sh);
    assert.ok(
      c.left >= 0 &&
        c.top >= 0 &&
        c.left + c.width <= sw + 1e-8 &&
        c.top + c.height <= sh + 1e-8,
    );
    assert.ok(Math.abs(c.width / c.height - width / height) < 1e-8);
    for (const normalized of [0, 0.25, 0.5, 0.9, 1]) {
      const sourceX = c.left + c.width * normalized,
        sourceY = c.top + c.height * normalized;
      assert.ok(
        Math.abs(
          sourceX * scale + (width - sw * scale) / 2 - width * normalized,
        ) < 1e-8,
      );
      assert.ok(
        Math.abs(
          sourceY * scale + (height - sh * scale) / 2 - height * normalized,
        ) < 1e-8,
      );
    }
  }
  assert.equal(cameraCrop(390, 660, 0, 0).width, 0);
  assert.equal(cameraCrop(Infinity, 660, 1280, 720).height, 0);
});
