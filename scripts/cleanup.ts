import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { cleanup, cloudEnabled } from "../lib/db";
import { pool } from "../lib/postgres-store";
await cleanup();
console.log(
  "Removed expired scan metadata and evidence according to retention settings.",
);
if (cloudEnabled()) await pool().end();
