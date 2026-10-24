import { AsyncLocalStorage } from "node:async_hooks";
import * as sqlite from "./sqlite";
import {
  cloudEnabled,
  pgGet,
  pgList,
  pgPut,
  pgRemove,
  pgTransaction,
  query,
} from "./postgres-store";
export {
  dataDir,
  db,
  hash,
  secret,
  equal,
  passwordDigest,
  checkPassword,
  uid,
} from "./sqlite";
export type { Document } from "./sqlite";
export { cloudEnabled, withRequestCache } from "./postgres-store";
const localContext = new AsyncLocalStorage<boolean>();
let queue = Promise.resolve();
async function local<T>(fn: () => T | Promise<T>): Promise<T> {
  if (localContext.getStore()) return fn();
  const before = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => {
    release = r;
  });
  await before;
  try {
    return await localContext.run(true, fn);
  } finally {
    release();
  }
}
export async function get<T>(kind: string, id: string): Promise<T | undefined> {
  return cloudEnabled()
    ? pgGet<T>(kind, id)
    : local(() => sqlite.get<T>(kind, id));
}
export async function list<T>(kind: string, scope?: string): Promise<T[]> {
  return cloudEnabled()
    ? pgList<T>(kind, scope)
    : local(() => sqlite.list<T>(kind, scope));
}
export async function put(
  kind: string,
  value: sqlite.Document,
  scope?: string,
) {
  if (cloudEnabled()) await pgPut(kind, value, scope);
  else await local(() => sqlite.put(kind, value, scope));
}
export async function remove(kind: string, id: string) {
  if (cloudEnabled()) await pgRemove(kind, id);
  else await local(() => sqlite.remove(kind, id));
}
export async function transaction<T>(
  fn: () => Promise<T> | T,
  lock?: string,
): Promise<T> {
  if (cloudEnabled()) return pgTransaction(async () => fn(), lock);
  return local(async () => {
    sqlite.db().exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      sqlite.db().exec("COMMIT");
      return result;
    } catch (e) {
      sqlite.db().exec("ROLLBACK");
      throw e;
    }
  });
}
export async function consume(key: string, limit: number) {
  if (!cloudEnabled()) return local(() => sqlite.consume(key, limit));
  const [row] = await query(
    "insert into app_private.quotas(key,count) values($1,1) on conflict(key) do update set count=quotas.count+1,updated_at=now() returning count",
    [key],
  );
  if (row.count > limit)
    throw Object.assign(
      new Error(
        "Scan allowance reached. Try again later or use manual reporting.",
      ),
      { status: 429 },
    );
}
export async function reportKey(
  session: string,
  key: string,
): Promise<string | undefined> {
  if (cloudEnabled())
    return (
      await query(
        "select report_id from app_private.report_keys where session_id=$1 and request_key=$2",
        [session, key],
      )
    )[0]?.report_id;
  return local(
    () =>
      (
        sqlite
          .db()
          .prepare(
            "SELECT report_id FROM report_keys WHERE session=? AND key=?",
          )
          .get(session, key) as { report_id: string } | undefined
      )?.report_id,
  );
}
export async function saveReportKey(session: string, key: string, id: string) {
  if (cloudEnabled())
    await query(
      "insert into app_private.report_keys(session_id,request_key,report_id) values($1,$2,$3)",
      [session, key, id],
    );
  else
    await local(() =>
      sqlite
        .db()
        .prepare("INSERT INTO report_keys VALUES(?,?,?)")
        .run(session, key, id),
    );
}
export async function config() {
  const stored = await get<{
    id: string;
    apiKey?: string;
    model?: string;
    passwordHash?: string;
  }>("setting", "connection");
  return {
    apiKey: process.env.GEMINI_API_KEY || stored?.apiKey || "",
    model: process.env.GEMINI_MODEL || stored?.model || "gemini-3.8-flash",
    passwordHash: process.env.ADMIN_PASSWORD
      ? sqlite.hash(process.env.ADMIN_PASSWORD)
      : stored?.passwordHash || "",
  };
}
export async function cleanup() {
  if (!cloudEnabled()) return local(() => sqlite.cleanup());
  const { cleanupMedia } = await import("./media");
  await cleanupMedia();
  await query(
    "delete from app_private.records where kind='scan' and data->>'receivedAt'<$1",
    [new Date(Date.now() - 600000).toISOString()],
  );
  await query(
    "delete from app_private.records where kind='session' and data->>'expiresAt'<$1",
    [new Date().toISOString()],
  );
  await query(
    "delete from app_private.quotas where updated_at<now()-interval '2 days'",
  );
}
