import { createHash, timingSafeEqual } from "node:crypto";
import { cleanup, cloudEnabled } from "@/lib/db";
import { cleanupMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store" };
const digest = (value: string) => createHash("sha256").update(value).digest();

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return Response.json(
      { error: "Scheduled cleanup is not configured." },
      { status: 503, headers },
    );
  if (
    !timingSafeEqual(
      digest(request.headers.get("authorization") || ""),
      digest(`Bearer ${secret}`),
    )
  )
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  if (!cloudEnabled())
    return Response.json(
      { error: "Scheduled cleanup requires cloud storage." },
      { status: 503, headers },
    );
  try {
    await cleanup();
    // A daily Hobby cron drains up to 5,000 expired objects in bounded batches.
    // Ordinary request cleanup retains the smaller one-batch default.
    await cleanupMedia({ maxBatches: 24, timeBudgetMs: 40000 });
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "Scheduled cleanup failed. Retry later." },
      { status: 503, headers },
    );
  }
}
