import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
process.env.DATA_BACKEND = "postgres";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inventory } from "../lib/inventory";
import { pool, query, pgPut, pgTransaction } from "../lib/postgres-store";
import { saveMedia } from "../lib/media";
const final = process.argv.includes("--final");
const sourceDir = path.resolve(process.env.TRASHME_DATA_DIR || ".data");
const sqlite = new DatabaseSync(path.join(sourceDir, "trashme.sqlite"), {
  readOnly: true,
});
sqlite.exec("BEGIN");
const docs = sqlite
  .prepare("SELECT kind,id,scope,data FROM documents")
  .all() as { kind: string; id: string; scope: string; data: string }[];
const keys = sqlite
  .prepare("SELECT session,key,report_id FROM report_keys")
  .all() as { session: string; key: string; report_id: string }[];
const quotas = sqlite.prepare("SELECT key,count FROM quotas").all() as {
  key: string;
  count: number;
}[];
sqlite.exec("COMMIT");
sqlite.close();
const completed = await query(
  "select version from app_private.migrations where version='sqlite-cutover'",
);
if (completed.length)
  throw new Error(
    "Cloud cutover is already recorded. Refusing to overwrite live cloud data with an older local snapshot.",
  );
const envFile = path.resolve(".env.local");
let envText = fs.readFileSync(envFile, "utf8");
const originalConnection = docs.find(
  (r) => r.kind === "setting" && r.id === "connection",
);
if (originalConnection) {
  const local = JSON.parse(originalConnection.data);
  if (local.apiKey && !/^GEMINI_API_KEY=/m.test(envText))
    envText += `GEMINI_API_KEY=${JSON.stringify(local.apiKey)}\n`;
  if (local.model && !/^GEMINI_MODEL=/m.test(envText))
    envText += `GEMINI_MODEL=${JSON.stringify(local.model)}\n`;
  fs.writeFileSync(envFile, envText, { mode: 0o600 });
}
const city = inventory();
try {
  await pgTransaction(async () => {
    for (let i = 0; i < city.length; i += 300) {
      await query(
        "insert into public.bins(id,scope,data) select value->>'id','public',value from jsonb_array_elements($1::jsonb) on conflict(id) do update set data=excluded.data",
        [JSON.stringify(city.slice(i, i + 300))],
      );
    }
    const ordered = [...docs].sort(
      (a, b) =>
        ["bin", "area", "case", "report"].indexOf(a.kind) -
        ["bin", "area", "case", "report"].indexOf(b.kind),
    );
    for (const row of ordered) {
      const data = JSON.parse(row.data);
      if (
        row.kind === "scan" &&
        Date.now() - Date.parse(data.receivedAt) > 600000
      )
        continue;
      if (row.kind === "setting" && row.id === "connection") delete data.apiKey;
      await pgPut(row.kind, data, row.scope);
    }
    for (const key of keys)
      await query(
        "insert into app_private.report_keys(session_id,request_key,report_id) values($1,$2,$3) on conflict(session_id,request_key) do nothing",
        [key.session, key.key, key.report_id],
      );
    for (const quota of quotas)
      await query(
        "insert into app_private.quotas(key,count) values($1,$2) on conflict(key) do update set count=greatest(quotas.count,excluded.count),updated_at=now()",
        [quota.key, quota.count],
      );
  }, "sqlite-import");
  console.log(
    "City inventory imported:",
    city.length,
    "; application records copied:",
    docs.length,
  );
  const retained = new Set<string>();
  for (const row of docs) {
    const data = JSON.parse(row.data);
    if (["report", "bin_evidence"].includes(row.kind) && data.mediaId)
      retained.add(data.mediaId);
    if (row.kind === "case")
      for (const a of data.actions || [])
        if (a.mediaId) retained.add(a.mediaId);
    if (
      row.kind === "scan" &&
      Date.now() - Date.parse(data.receivedAt) < 600000
    )
      retained.add(data.mediaId);
  }
  let images = 0;
  for (const id of retained) {
    const file = path.join(sourceDir, "media", id + ".jpg");
    if (!fs.existsSync(file)) continue;
    const deadline =
      fs.statSync(file).mtimeMs +
      Math.max(1, Number(process.env.EVIDENCE_RETENTION_DAYS || 7)) * 86400000;
    if (deadline <= Date.now()) continue;
    const present = await query(
      "select id from app_private.media where id=$1",
      [id],
    );
    if (!present.length) await saveMedia(id, fs.readFileSync(file));
    await query("update app_private.media set expires_at=$2 where id=$1", [
      id,
      new Date(deadline).toISOString(),
    ]);
    images++;
  }
  console.log(
    "Existing retained images verified in private Supabase Storage:",
    images,
  );
  const counts = await query(
    "select (select count(*) from public.bins)::int bins,(select count(*) from public.cases)::int cases,(select count(*) from public.reports)::int reports,(select count(*) from app_private.media)::int images",
  );
  console.log("Cloud counts:", counts[0]);
  if (final) {
    await query(
      "insert into app_private.migrations(version) values('sqlite-cutover')",
    );
    console.log(
      "Final migration checkpoint recorded. Activate DATA_BACKEND=postgres only after verification.",
    );
  }
} finally {
  await pool().end();
}
