import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { backup } from "node:sqlite";
import fs from "node:fs";
import { db, dataDir, cloudEnabled } from "../lib/db";
import { query, readSnapshot, pool } from "../lib/postgres-store";
import path from "node:path";
const stamp = new Date().toISOString().replaceAll(":", "-");
if (cloudEnabled()) {
  try {
    const snapshot = await readSnapshot(async () => {
      const tables: Record<string, unknown[]> = {};
      for (const table of [
        "public.bins",
        "public.areas",
        "public.cases",
        "public.reports",
        "app_private.records",
        "app_private.report_keys",
        "app_private.quotas",
        "app_private.media",
        "app_private.migrations",
      ])
        tables[table] = await query(`select * from ${table}`);
      return {
        version: 1,
        createdAt: new Date().toISOString(),
        images:
          "Objects remain in private Supabase Storage; this export contains metadata only.",
        tables,
      };
    });
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const destination = path.join(dataDir, `cloud-data-${stamp}.json`);
    fs.writeFileSync(destination, JSON.stringify(snapshot), { mode: 0o600 });
    console.log(destination);
    console.log(
      "Private logical data export complete. Image objects remain only in Supabase Storage.",
    );
  } finally {
    await pool().end();
  }
} else {
  const destination = path.join(dataDir, `backup-${stamp}.sqlite`);
  await backup(db(), destination);
  console.log(destination);
}
