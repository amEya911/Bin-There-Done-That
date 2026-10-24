import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  createHash,
  randomBytes,
  timingSafeEqual,
  scryptSync,
} from "node:crypto";
import type { Area, Bin, Case, Demo, Report, Scan } from "./types";
export const dataDir = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  process.env.TRASHME_DATA_DIR || ".data",
);
const registry = globalThis as typeof globalThis & {
  trashmeDatabase?: DatabaseSync;
  trashmeMaintenance?: ReturnType<typeof setInterval>;
};
let instance: DatabaseSync | undefined = registry.trashmeDatabase;
export function db() {
  if (instance) return instance;
  fs.mkdirSync(path.join(dataDir, "media"), { recursive: true, mode: 0o700 });
  instance = new DatabaseSync(path.join(dataDir, "trashme.sqlite"));
  instance.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL,id TEXT NOT NULL,scope TEXT NOT NULL DEFAULT 'public',data TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS documents_scope ON documents(kind,scope);
    CREATE TABLE IF NOT EXISTS report_keys (session TEXT NOT NULL,key TEXT NOT NULL,report_id TEXT NOT NULL,PRIMARY KEY(session,key));
    CREATE TABLE IF NOT EXISTS quotas (key TEXT PRIMARY KEY,count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
  `);
  registry.trashmeDatabase = instance;
  fs.chmodSync(path.join(dataDir, "trashme.sqlite"), 0o600);
  if (!registry.trashmeMaintenance) {
    registry.trashmeMaintenance = setInterval(() => {
      try {
        cleanup();
      } catch {
        /* Retry on the next interval; no sensitive data is logged. */
      }
    }, 3600000);
    registry.trashmeMaintenance.unref();
  }
  if (!get<Area>("area", "downtown-pilot")) {
    put("area", {
      id: "downtown-pilot",
      name: "Downtown pilot area",
      scope: "public",
      active: true,
      polygon: [
        [-79.418, 43.637],
        [-79.367, 43.637],
        [-79.367, 43.674],
        [-79.418, 43.674],
        [-79.418, 43.637],
      ],
      createdAt: new Date().toISOString(),
    });
  }
  return instance;
}
export type Document =
  | Area
  | Bin
  | Case
  | Demo
  | Report
  | Scan
  | { id: string; [key: string]: unknown };
export function get<T>(kind: string, id: string): T | undefined {
  const row = db()
    .prepare("SELECT data FROM documents WHERE kind=? AND id=?")
    .get(kind, id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export function list<T>(kind: string, scope?: string): T[] {
  const rows = (
    scope === undefined
      ? db().prepare("SELECT data FROM documents WHERE kind=?").all(kind)
      : db()
          .prepare("SELECT data FROM documents WHERE kind=? AND scope=?")
          .all(kind, scope)
  ) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}
export function put(kind: string, value: Document, scope?: string) {
  db()
    .prepare(
      "INSERT INTO documents(kind,id,scope,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET scope=excluded.scope,data=excluded.data",
    )
    .run(
      kind,
      value.id,
      scope ?? ("scope" in value ? String(value.scope) : "public"),
      JSON.stringify(value),
    );
}
export function remove(kind: string, id: string) {
  db().prepare("DELETE FROM documents WHERE kind=? AND id=?").run(kind, id);
}
export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db().exec("COMMIT");
    return value;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}
export function hash(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
export function secret() {
  return randomBytes(32).toString("base64url");
}
export function equal(a: string, b: string) {
  const x = Buffer.from(hash(a)),
    y = Buffer.from(hash(b));
  return timingSafeEqual(x, y);
}
export function passwordDigest(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function checkPassword(password: string, digest: string) {
  const [salt, key] = digest.split(":");
  if (!salt || !key) return false;
  return equal(scryptSync(password, salt, 64).toString("hex"), key);
}
export function uid() {
  return randomUUID();
}
export function consume(key: string, limit: number) {
  const row = db()
    .prepare(
      "INSERT INTO quotas(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
    .get(key) as { count: number };
  if (row.count > limit)
    throw Object.assign(
      new Error(
        "Scan allowance reached. Try again later or use manual reporting.",
      ),
      { status: 429 },
    );
}
export function config() {
  const local = get<{
    id: string;
    apiKey?: string;
    model?: string;
    passwordHash?: string;
  }>("setting", "connection");
  return {
    apiKey: process.env.GEMINI_API_KEY || local?.apiKey || "",
    model: process.env.GEMINI_MODEL || local?.model || "gemini-3.8-flash",
    passwordHash: process.env.ADMIN_PASSWORD
      ? hash(process.env.ADMIN_PASSWORD)
      : local?.passwordHash || "",
  };
}
export function cleanup() {
  const now = Date.now(),
    days = Number(process.env.EVIDENCE_RETENTION_DAYS || 7);
  const retained = new Set(list<Report>("report").map((r) => r.mediaId));
  for (const scan of list<Scan>("scan"))
    if (now - Date.parse(scan.receivedAt) > 10 * 60_000) {
      remove("scan", scan.id);
      const p = path.join(dataDir, "media", scan.mediaId + ".jpg");
      if (!retained.has(scan.mediaId) && fs.existsSync(p)) fs.unlinkSync(p);
    }
  const mediaDir = path.join(dataDir, "media");
  for (const filename of fs.readdirSync(mediaDir)) {
    const p = path.join(mediaDir, filename);
    if (now - fs.statSync(p).mtimeMs > Math.max(1, days) * 86400000)
      fs.unlinkSync(p);
  }
}
