import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { cloudEnabled, query } from "./postgres-store";
import { dataDir } from "./sqlite";
const days = () =>
  Math.max(1, Number(process.env.EVIDENCE_RETENTION_DAYS || 7));
let client: ReturnType<typeof createClient> | undefined;
function bucket() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
      throw Object.assign(
        new Error("Supabase image storage is not configured."),
        { status: 503 },
      );
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client.storage.from(
    process.env.SUPABASE_STORAGE_BUCKET || "bin-evidence",
  );
}
function validId(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id))
    throw Object.assign(new Error("Image not found."), { status: 404 });
}
export async function saveMedia(id: string, buffer: Buffer, temporary = false) {
  validId(id);
  if (!cloudEnabled()) {
    fs.mkdirSync(path.join(dataDir, "media"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dataDir, "media", id + ".jpg"), buffer, {
      mode: 0o600,
    });
    return;
  }
  const objectPath = `evidence/${id}.jpg`;
  const { error } = await bucket().upload(objectPath, buffer, {
    contentType: "image/jpeg",
    cacheControl: "0",
    upsert: false,
  });
  if (error)
    throw Object.assign(
      new Error("The image could not be saved. Please try again."),
      { status: 503 },
    );
  try {
    await query(
      "insert into app_private.media(id,object_path,expires_at) values($1,$2,$3)",
      [
        id,
        objectPath,
        new Date(
          Date.now() + (temporary ? 600000 : days() * 86400000),
        ).toISOString(),
      ],
    );
  } catch (e) {
    await bucket().remove([objectPath]);
    throw e;
  }
}
export async function retainMedia(id?: string) {
  if (id && cloudEnabled())
    await query(
      "update app_private.media set expires_at=now()+($2::int*interval '1 day') where id=$1",
      [id, days()],
    );
}
export async function removeMedia(id: string) {
  validId(id);
  if (!cloudEnabled()) {
    const file = path.join(dataDir, "media", id + ".jpg");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  const [row] = await query(
    "select object_path from app_private.media where id=$1",
    [id],
  );
  if (!row) return;
  const { error } = await bucket().remove([row.object_path]);
  if (error)
    throw Object.assign(
      new Error("The image could not be removed. Please retry."),
      { status: 503 },
    );
  await query("delete from app_private.media where id=$1", [id]);
}
export async function readMedia(id: string): Promise<Buffer> {
  validId(id);
  if (!cloudEnabled()) {
    const file = path.join(dataDir, "media", id + ".jpg");
    if (!fs.existsSync(file))
      throw Object.assign(new Error("This evidence image has expired."), {
        status: 404,
      });
    if (Date.now() - fs.statSync(file).mtimeMs > days() * 86400000) {
      fs.unlinkSync(file);
      throw Object.assign(new Error("This evidence image has expired."), {
        status: 404,
      });
    }
    return fs.readFileSync(file);
  }
  const [row] = await query(
    "select object_path,expires_at from app_private.media where id=$1",
    [id],
  );
  if (!row || Date.parse(row.expires_at) <= Date.now())
    throw Object.assign(new Error("This evidence image has expired."), {
      status: 404,
    });
  const { data, error } = await bucket().download(row.object_path);
  if (error || !data)
    throw Object.assign(
      new Error("The evidence image is unavailable. Please retry."),
      { status: 503 },
    );
  return Buffer.from(await data.arrayBuffer());
}
export async function cleanupMedia() {
  if (!cloudEnabled()) return;
  const rows = await query(
    "select id from app_private.media where expires_at<now() order by expires_at limit 200",
  );
  for (const row of rows) await removeMedia(row.id);
}
