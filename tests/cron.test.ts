import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

process.env.DATA_BACKEND = "postgres";
process.env.DATABASE_HOST = "database.invalid";
process.env.DATABASE_PASSWORD = "test-only-password";
process.env.SUPABASE_URL = "https://test-project.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-only-key";
process.env.VERCEL = "1";
const { GET } = await import("../app/api/cron/cleanup/route");
const { cleanupMedia } = await import("../lib/media");
const { pool } = await import("../lib/postgres-store");
const request = (authorization?: string) =>
  new Request("https://whichbin.fyi/api/cron/cleanup", {
    headers: authorization ? { authorization } : {},
  });

after(async () => {
  await pool().end();
});

test("cron fails closed without a configured secret", async () => {
  delete process.env.CRON_SECRET;
  const response = await GET(request("Bearer supplied-without-config"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("cron rejects missing, incorrect and malformed bearer tokens without touching data", async (t) => {
  process.env.CRON_SECRET = "test-only-cron-secret";
  const query = t.mock.method(Pool.prototype, "query", () => {
    throw new Error("Unauthorized requests must not reach the database.");
  });
  for (const token of [undefined, "Bearer wrong", "test-only-cron-secret", "bearer test-only-cron-secret"])
    assert.equal((await GET(request(token))).status, 401);
  assert.equal(query.mock.callCount(), 0);
});

test("authorized cron requires PostgreSQL and does not fall back to local files", async () => {
  process.env.DATA_BACKEND = "sqlite";
  try {
    assert.equal(
      (await GET(request("Bearer test-only-cron-secret"))).status,
      503,
    );
  } finally {
    process.env.DATA_BACKEND = "postgres";
  }
});

test("authorized cron cleans expired records without creating a user session", async (t) => {
  const statements: string[] = [];
  t.mock.method(Pool.prototype, "query", async (sql: string) => {
    statements.push(sql);
    return { rows: [] };
  });
  const response = await GET(request("Bearer test-only-cron-secret"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(statements.some((sql) => sql.includes("kind='session'")));
  assert.ok(statements.some((sql) => sql.includes("app_private.quotas")));
  assert.ok(statements.every((sql) => !sql.includes("insert into")));
  const registry = globalThis as typeof globalThis & { binCloudMaintenance?: unknown };
  assert.equal(registry.binCloudMaintenance, undefined);
});

test("media cleanup removes Storage objects in bounded batches before deleting metadata", async (t) => {
  let batches = 0;
  const events: string[] = [];
  t.mock.method(Pool.prototype, "query", async (sql: string, values?: unknown[]) => {
    if (sql.startsWith("select id,object_path")) {
      batches++;
      return {
        rows: Array.from({ length: 200 }, (_, i) => ({
          id: `${batches}-${i}`,
          object_path: `evidence/${batches}-${i}.jpg`,
        })),
      };
    }
    assert.match(sql, /^delete from app_private.media/);
    assert.equal((values?.[0] as string[]).length, 200);
    events.push("metadata");
    return { rows: [] };
  });
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    assert.equal(init?.method, "DELETE");
    assert.equal(JSON.parse(String(init?.body)).prefixes.length, 200);
    events.push("storage");
    return Response.json([]);
  });
  assert.equal(await cleanupMedia({ maxBatches: 2 }), 400);
  assert.equal(batches, 2);
  assert.deepEqual(events, ["storage", "metadata", "storage", "metadata"]);
});

test("failed Storage removal keeps metadata for a later retry", async (t) => {
  const query = t.mock.method(Pool.prototype, "query", async () => ({
    rows: [{ id: "expired", object_path: "evidence/expired.jpg" }],
  }));
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ message: "private provider diagnostic" }, { status: 500 }),
  );
  await assert.rejects(cleanupMedia(), /Expired images could not be removed/);
  assert.equal(query.mock.callCount(), 1);
});
