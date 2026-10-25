import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bin-provider-health-"));
process.env.DATA_BACKEND = "sqlite";
process.env.TRASHME_DATA_DIR = temp;
process.env.GEMINI_API_KEY = "test-placeholder-key";
process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
const store = await import("../lib/db");
const { providerFailure, providerHealth, recordProviderHealth } = await import("../lib/provider-health");

after(() => {
  store.db().close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("a comparison model's failure cannot mark the active model unhealthy", async () => {
  await providerFailure({ status: 403 }, { apiKey: "test-placeholder-key", model: "comparison-model" });
  assert.equal(await providerHealth(), undefined);
  await recordProviderHealth("ready", "", { apiKey: "test-placeholder-key", model: "gemini-3.5-flash-lite" });
  assert.equal((await providerHealth())?.state, "ready");
  await providerFailure({ status: 429 }, { apiKey: "test-placeholder-key", model: "gemini-3.5-flash-lite" });
  assert.equal((await providerHealth())?.state, "quota_exceeded");
});
