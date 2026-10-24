import { config, get, put, hash } from "./db";
import { HttpError } from "./auth";
type Health = {
  id: string;
  credentialHash: string;
  model: string;
  state: "ready" | "billing_required" | "access_denied" | "quota_exceeded";
  message: string;
  checkedAt: string;
};
export async function providerHealth() {
  const c = await config(),
    health = await get<Health>("setting", "gemini_health");
  return health &&
    health.credentialHash === hash(c.apiKey) &&
    health.model === c.model
    ? health
    : undefined;
}
export async function recordProviderHealth(
  state: Health["state"],
  message = "",
) {
  const c = await config();
  await put("setting", {
    id: "gemini_health",
    credentialHash: hash(c.apiKey),
    model: c.model,
    state,
    message,
    checkedAt: new Date().toISOString(),
  });
}
export async function providerFailure(error: unknown) {
  if (error instanceof HttpError) return error;
  const status = Number(
    (
      error as {
        status?: number;
        statusCode?: number;
      }
    )?.status ||
      (
        error as {
          statusCode?: number;
        }
      )?.statusCode,
  );
  if (status === 402) {
    const message =
      "Gemini’s prepaid credits are depleted. Add credits in Google AI Studio, then retry the connection.";
    await recordProviderHealth("billing_required", message);
    return new HttpError(402, message);
  }
  if (status === 401 || status === 403) {
    const message =
      "Gemini rejected this key or its model permissions. Check the key in Setup.";
    await recordProviderHealth("access_denied", message);
    return new HttpError(503, message);
  }
  if (status === 429) {
    const message =
      "Gemini’s usage allowance has been reached. Wait before retrying the connection.";
    await recordProviderHealth("quota_exceeded", message);
    return new HttpError(429, message);
  }
  return new HttpError(
    502,
    "Gemini could not return a usable result. Retry the connection or try a clearer view.",
  );
}
