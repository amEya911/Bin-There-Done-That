import assert from "node:assert/strict";
import test from "node:test";
import {
  createReportDraft,
  readReportDraft,
  removeReportDraft,
  REPORT_DRAFT_TTL_MS,
} from "../lib/report-draft";

const photo = "data:image/jpeg;base64,AA==";
const capturedAt = "2026-10-24T22:00:00.000Z";
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
test("report drafts carry only an opaque URL ID and retain exact photo, capture time and issue", () => {
  const store = memory();
  const created = createReportDraft(
    {
      image: photo,
      capturedAt,
      note: "Waste above the rim",
      returnTo: "/scan/test",
    },
    store,
    1000,
  );
  assert.equal(created.href, `/report?draft=${created.id}`);
  assert.ok(
    !created.href.includes("data:") && !created.href.includes(capturedAt),
  );
  const draft = readReportDraft(created.id, store, 1001)!;
  assert.equal(draft.image, photo);
  assert.equal(draft.capturedAt, capturedAt);
  assert.equal(draft.note, "Waste above the rim");
  assert.equal(draft.issue, "overflowing");
  assert.equal(draft.returnTo, "/scan/test");
  assert.equal(readReportDraft(created.id, memory(), 1001), null);
});
test("expired, discarded and superseded photo drafts cannot be submitted again", () => {
  const store = memory();
  const first = createReportDraft({ image: photo, capturedAt }, store, 1000);
  assert.equal(
    readReportDraft(first.id, store, 1000 + REPORT_DRAFT_TTL_MS),
    null,
  );
  const second = createReportDraft({ image: photo, capturedAt }, store, 2000);
  const third = createReportDraft({ image: photo, capturedAt }, store, 2001);
  assert.equal(readReportDraft(second.id, store, 2002), null);
  assert.ok(readReportDraft(third.id, store, 2002));
  removeReportDraft(third.id, store);
  assert.equal(readReportDraft(third.id, store, 2003), null);
});
test("drafts reject arbitrary image URLs and normalize return paths and scope", () => {
  const store = memory();
  assert.throws(
    () =>
      createReportDraft(
        { image: "https://example.com/photo.jpg", capturedAt },
        store,
      ),
    /photo/,
  );
  assert.throws(
    () => createReportDraft({ image: photo, capturedAt: "invalid" }, store),
    /photo/,
  );
  const { id } = createReportDraft(
    { image: photo, capturedAt, returnTo: "//example.com", scope: "admin" },
    store,
    1000,
  );
  const draft = readReportDraft(id, store, 1001)!;
  assert.equal(draft.returnTo, "/scan?camera=off");
  assert.equal(draft.scope, "public");
});
test("blocked or malformed tab storage recovers without exposing a broken report", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(
    readReportDraft("01234567-0123-0123-0123-012345678901", blocked),
    null,
  );
  assert.doesNotThrow(() =>
    removeReportDraft("01234567-0123-0123-0123-012345678901", blocked),
  );
  assert.throws(
    () => createReportDraft({ image: photo, capturedAt }, blocked),
    /browser could not keep/,
  );
  const store = memory();
  const { id } = createReportDraft({ image: photo, capturedAt }, store, 1000);
  store.setItem(`bin-there:report-draft:${id}`, "bad json");
  assert.equal(readReportDraft(id, store, 1001), null);
});
