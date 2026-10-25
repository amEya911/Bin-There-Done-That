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
  if (!file.size || (file.type && !file.type.startsWith("image/")))
    throw new Error("Choose a photo of the bin.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("Could not open this photo. Try a JPEG or PNG image.");
    }
    const scale = Math.min(
      1,
      1280 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Could not prepare this photo. Please try again.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (quality: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(
                  new Error("Could not prepare this photo. Please try again."),
                ),
          "image/jpeg",
          quality,
        );
      });
    let photo = await encode(0.82);
    if (photo.size > 2_800_000) photo = await encode(0.6);
    // Leave room for base64 expansion and the other fields in a report request.
    if (photo.size > 2_800_000)
      throw new Error(
        "This photo is too large. Take another photo and try again.",
      );
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read this photo."));
      reader.onabort = () =>
        reject(new Error("Reading this photo was cancelled."));
      reader.readAsDataURL(photo);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
