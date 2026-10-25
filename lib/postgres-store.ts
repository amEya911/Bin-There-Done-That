import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { Pool, type PoolClient } from "pg";
import type { Area, Bin, Point } from "./types";
const tables: Record<string, string> = {
  bin: "public.bins",
  area: "public.areas",
  case: "public.cases",
  report: "public.reports",
};
const context = new AsyncLocalStorage<{
  client?: PoolClient;
  cache: Map<string, Promise<unknown>>;
}>();
const registry = globalThis as typeof globalThis & {
  binPostgres?: Pool;
  binCloudMaintenance?: ReturnType<typeof setInterval>;
};
export function cloudEnabled() {
  return process.env.DATA_BACKEND === "postgres";
}
export function pool() {
  if (registry.binPostgres) return registry.binPostgres;
  const connection = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : null;
  const host = connection?.hostname || process.env.DATABASE_HOST;
  const password = connection
    ? decodeURIComponent(connection.password)
    : process.env.DATABASE_PASSWORD;
  if (!host || !password)
    throw new Error("The PostgreSQL connection is not configured.");
  registry.binPostgres = new Pool({
    host,
    port: Number(connection?.port || process.env.DATABASE_PORT || 6543),
    user: connection
      ? decodeURIComponent(connection.username)
      : process.env.DATABASE_USER,
    password,
    database:
      connection?.pathname.slice(1) || process.env.DATABASE_NAME || "postgres",
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_SSL_CA_FILE
        ? { ca: fs.readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8") }
        : {}),
    },
    max: 3,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    application_name: "bin-there-done-that",
  });
  registry.binPostgres.on("error", () => {
    /* A subsequent request obtains a fresh connection. Never log credentials. */
  });
  if (!process.env.VERCEL && !registry.binCloudMaintenance) {
    registry.binCloudMaintenance = setInterval(async () => {
      try {
        const { cleanup } = await import("./db");
        await cleanup();
      } catch {
        /* Retry on the next interval. */
      }
    }, 3600000);
    registry.binCloudMaintenance.unref();
  }
  return registry.binPostgres;
}
export async function query<T = any>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await (context.getStore()?.client || pool()).query(sql, values)).rows;
}
export function withRequestCache<T>(fn: () => Promise<T>) {
  return context.run({ cache: new Map() }, fn);
}
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cache = context.getStore()?.cache;
  if (!cache) return fn();
  if (!cache.has(key)) cache.set(key, fn());
  return structuredClone(await cache.get(key)) as T;
}
export async function pgGet<T>(
  kind: string,
  id: string,
): Promise<T | undefined> {
  return cached(`get:${kind}:${id}`, async () => {
    const table = tables[kind];
    const rows = table
      ? await query(`select data from ${table} where id=$1`, [id])
      : await query(
          "select data from app_private.records where kind=$1 and id=$2",
          [kind, id],
        );
    return rows[0]?.data as T | undefined;
  });
}
export async function pgList<T>(kind: string, scope?: string): Promise<T[]> {
  return cached(`list:${kind}:${scope ?? "*"}`, async () => {
    const table = tables[kind];
    const rows = table
      ? await query(
          `select data from ${table}${scope === undefined ? "" : " where scope=$1"}`,
          scope === undefined ? [] : [scope],
        )
      : await query(
          `select data from app_private.records where kind=$1${scope === undefined ? "" : " and scope=$2"}`,
          scope === undefined ? [kind] : [kind, scope],
        );
    return rows.map((r) => r.data as T);
  });
}
export async function pgPut(
  kind: string,
  value: { id: string; [k: string]: any },
  scope?: string,
) {
  const table = tables[kind],
    space = scope ?? value.scope ?? "public";
  if (table)
    await query(
      `insert into ${table}(id,scope,data) values($1,$2,$3::jsonb) on conflict(id) do update set scope=excluded.scope,data=excluded.data`,
      [value.id, space, JSON.stringify(value)],
    );
  else
    await query(
      "insert into app_private.records(kind,id,scope,data) values($1,$2,$3,$4::jsonb) on conflict(kind,id) do update set scope=excluded.scope,data=excluded.data",
      [kind, value.id, space, JSON.stringify(value)],
    );
  context.getStore()?.cache.clear();
}
export async function pgRemove(kind: string, id: string) {
  const table = tables[kind];
  if (table) await query(`delete from ${table} where id=$1`, [id]);
  else
    await query("delete from app_private.records where kind=$1 and id=$2", [
      kind,
      id,
    ]);
  context.getStore()?.cache.clear();
}
export async function pgTransaction<T>(
  fn: () => Promise<T>,
  lock = "application-write",
): Promise<T> {
  if (context.getStore()?.client) return fn();
  for (let attempt = 0; ; attempt++) {
    const client = await pool().connect();
    try {
      await client.query("begin isolation level serializable");
      await client.query("set local statement_timeout='20s'");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [lock],
      );
      const result = await context.run({ client, cache: new Map() }, fn);
      await client.query("commit");
      context.getStore()?.cache.clear();
      return result;
    } catch (e) {
      await client.query("rollback");
      if (
        attempt < 3 &&
        ["40001", "40P01"].includes((e as { code?: string }).code || "")
      )
        continue;
      throw e;
    } finally {
      client.release();
    }
  }
}
export async function pgNearby(
  point: Point,
  scope: string,
  meters: number,
  includeRejected = false,
): Promise<(Bin & { distance: number })[]> {
  return query<{ data: Bin; distance: number }>(
    `select data,extensions.st_distance(location,extensions.st_setsrid(extensions.st_makepoint($1,$2),4326)::extensions.geography) as distance
    from public.bins where (source='toronto' or scope=$3) and ${includeRejected ? "approval<>'rejected'" : "status='Existing' and approval='approved'"}
    ${Number.isFinite(meters) ? "and extensions.st_dwithin(location,extensions.st_setsrid(extensions.st_makepoint($1,$2),4326)::extensions.geography,$4)" : ""}
    order by location operator(extensions.<->) extensions.st_setsrid(extensions.st_makepoint($1,$2),4326)::extensions.geography limit 100`,
    Number.isFinite(meters) ? [...point, scope, meters] : [...point, scope],
  ).then((rows) =>
    rows.map((r) => ({ ...r.data, distance: Number(r.distance) })),
  );
}
export async function pgArea(
  point: Point,
  scope: string,
): Promise<Area | undefined> {
  const rows = await query(
    "select data from public.areas where scope=$3 and active and extensions.st_covers(boundary,extensions.st_setsrid(extensions.st_makepoint($1,$2),4326)) limit 1",
    [...point, scope],
  );
  return rows[0]?.data;
}

export async function readSnapshot<T>(fn: () => Promise<T>): Promise<T> {
  if (!cloudEnabled() || context.getStore()?.client) return fn();
  const client = await pool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const value = await context.run({ client, cache: new Map() }, fn);
    await client.query("commit");
    return value;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
