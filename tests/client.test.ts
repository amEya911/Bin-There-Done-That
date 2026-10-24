import { test } from "node:test";
import assert from "node:assert/strict";
import { api, post } from "../lib/client";

test("HTML tunnel errors retry a read and recover without exposing parser or proxy text", async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      calls++;
      assert.equal(
        new Headers(options.headers).get("Accept"),
        "application/json",
      );
      return calls === 1
        ? new Response(
            "<!doctype html><title>Private proxy diagnostics</title>",
            { status: 502, headers: { "Content-Type": "text/html" } },
          )
        : Response.json({ totalReports: 1 });
    },
  );
  assert.deepEqual(await api("/api/dashboard"), { totalReports: 1 });
  assert.equal(calls, 2);
});

test("persistent HTML or malformed JSON gets a readable error; writes are never retried", async (t) => {
  let calls = 0;
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("<!doctype html>secret diagnostics", {
      headers: { "Content-Type": "text/html" },
    });
  });
  await assert.rejects(api("/api/dashboard"), {
    message: "Connection to the app was interrupted. Please try again.",
  });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    post("/api/reports", { idempotencyKey: "keep-original-key" }),
    /Connection to the app was interrupted/,
  );
  assert.equal(calls, 1);
  calls = 0;
  fetch.mock.mockImplementation(async () => {
    calls++;
    return new Response('{"truncated":', {
      headers: { "Content-Type": "application/json" },
    });
  });
  await assert.rejects(api("/api/dashboard"), {
    message: "The app’s response was interrupted. Please try again.",
  });
  assert.equal(calls, 2);
});

test("network retries respect cancellation and ordinary API validation errors stay intact", async (t) => {
  let calls = 0;
  const abort = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  });
  const pending = api("/api/dashboard", { signal: abort.signal });
  queueMicrotask(() => abort.abort());
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
  calls = 0;
  fetch.mock.mockImplementation(async () => {
    calls++;
    return Response.json(
      { error: "Choose an active, approved bin." },
      { status: 400 },
    );
  });
  await assert.rejects(post("/api/reports", {}), {
    message: "Choose an active, approved bin.",
  });
  assert.equal(calls, 1);
});
