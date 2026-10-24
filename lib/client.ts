class ConnectionError extends Error {
  constructor(
    message: string,
    public retryable = true,
  ) {
    super(message);
  }
}

function retryDelay(signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason || new DOMException("Request cancelled", "AbortError"),
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 350);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const readOnly = (options.method || "GET").toUpperCase() === "GET";
  for (let attempt = 0; ; attempt++) {
    try {
      let r: Response;
      try {
        r = await fetch(url, { ...options, headers });
      } catch (e) {
        if (
          options.signal?.aborted ||
          (e instanceof Error && e.name === "AbortError")
        )
          throw e;
        throw new ConnectionError(
          "Couldn’t reach the app. Check your connection and try again.",
        );
      }
      const temporary = [502, 503, 504].includes(r.status);
      const contentType = r.headers.get("Content-Type") || "";
      if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
        await r.body?.cancel();
        throw new ConnectionError(
          "Connection to the app was interrupted. Please try again.",
          r.ok || temporary,
        );
      }
      let data: any;
      try {
        data = await r.json();
      } catch (e) {
        if (
          options.signal?.aborted ||
          (e instanceof Error && e.name === "AbortError")
        )
          throw e;
        throw new ConnectionError(
          "The app’s response was interrupted. Please try again.",
        );
      }
      if (!r.ok) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : "The request could not be completed.";
        if (temporary) throw new ConnectionError(message);
        throw new Error(message);
      }
      return data;
    } catch (e) {
      // Reconnect a data read once. Writes retain their caller-owned retry key
      // and must never be resubmitted automatically after an uncertain response.
      if (
        readOnly &&
        attempt === 0 &&
        e instanceof ConnectionError &&
        e.retryable
      ) {
        await retryDelay(options.signal);
        continue;
      }
      throw e;
    }
  }
}
export function post<T = any>(url: string, data: unknown) {
  return api<T>(url, { method: "POST", body: JSON.stringify(data) });
}
export const scoped = (path: string, scope = "public") =>
  `${path}${path.includes("?") ? "&" : "?"}scope=${encodeURIComponent(scope)}`;
export function relative(date: string) {
  const n = Math.max(0, Math.round((Date.now() - Date.parse(date)) / 60000));
  return n < 1
    ? "Just now"
    : n < 60
      ? `${n}m ago`
      : n < 1440
        ? `${Math.floor(n / 60)}h ago`
        : new Date(date).toLocaleDateString("en-CA", {
            month: "short",
            day: "numeric",
          });
}
export function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}
export const stateLabels: Record<string, string> = {
  observed: "Observed",
  needs_review: "Needs review",
  ready: "Ready for handoff",
  assigned: "Assigned",
  work_complete: "Work marked complete",
  rechecked: "Condition rechecked",
  resolved: "Resolved by community",
  reopened: "Reopened",
};
export async function imageData(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Choose an image smaller than 8 MB.");
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read this image."));
    r.readAsDataURL(file);
  });
}
