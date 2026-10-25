"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  LocateFixed,
  MapPin,
  X,
  Check,
  ArrowUpRight,
  ArrowRight,
  ScanLine,
  TriangleAlert,
  Trash2,
  Recycle,
  Leaf,
  RotateCcw,
} from "lucide-react";
import { Brand } from "./ui";
import AROverlay from "./ar-overlay";
import ManualReport from "./manual-report";
import { cameraCrop, containedFrame, guidanceLabel } from "@/lib/ar";
import { api, post, scoped, shortId } from "@/lib/client";
import { autoMatch } from "@/lib/geo";
import { createReportDraft } from "@/lib/report-draft";
import type { Bin, Detection, Guidance, Point } from "@/lib/types";

type Result = {
  id: string;
  detection: Detection;
  guidance: Guidance[];
  capturedAt: string;
  latencyMs: number;
  width: number;
  height: number;
};
type Capture = {
  image: string;
  capturedAt: number;
  width: number;
  height: number;
};

export default function Scanner({
  scope = "public",
  demoId,
  cameraOff = false,
}: {
  scope?: string;
  demoId?: string;
  cameraOff?: boolean;
}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    stream = useRef<MediaStream | null>(null);
  const generation = useRef(0),
    cameraRequest = useRef(0),
    captureAbort = useRef<AbortController | null>(null);
  const surface = useRef<HTMLDivElement>(null),
    watchId = useRef<number | null>(null),
    locationWatch = useRef(0),
    locationRequest = useRef(0);
  const capturedRef = useRef<Capture | null>(null),
    captureTaken = useRef(false),
    busy = useRef(false);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [captureHint, setCaptureHint] = useState(
    "Taking a photo in 2 seconds…",
  );
  const [camera, setCamera] = useState<
    "opening" | "ready" | "captured" | "denied" | "unsupported" | "off"
  >(cameraOff ? "off" : "opening");
  const [visible, setVisible] = useState(true),
    [captured, setCaptured] = useState<Capture | null>(null),
    [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("Hold an item or a bin in view."),
    [analyzing, setAnalyzing] = useState(false);
  const [gps, setGps] = useState<{
    point: Point;
    accuracy: number;
    locatedAt: string;
  } | null>(null);
  const [gpsMessage, setGpsMessage] = useState(
      "Location starts with the camera",
    ),
    [bin, setBin] = useState<Bin | null>(null);
  const [match, setMatch] = useState<"auto" | "selected" | "demo">("auto"),
    [locationOpen, setLocationOpen] = useState(false);
  const [search, setSearch] = useState(""),
    [options, setOptions] = useState<(Bin & { distance?: number })[]>([]);
  const [receipt, setReceipt] = useState<any>(null),
    [manualOpen, setManualOpen] = useState(false),
    [joined, setJoined] = useState(!demoId);
  const [frameStyle, setFrameStyle] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const binRef = useRef(bin),
    gpsRef = useRef(gps),
    matchRef = useRef(match);
  const dialog = useRef<HTMLDivElement>(null),
    dialogTrigger = useRef<HTMLElement | null>(null);
  const locationActive = camera === "ready" || camera === "captured";
  binRef.current = bin;
  gpsRef.current = gps;
  matchRef.current = match;

  function stopTracks() {
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  function cancelAttempt() {
    generation.current++;
    cameraRequest.current++;
    captureAbort.current?.abort();
    captureAbort.current = null;
    busy.current = false;
    setAnalyzing(false);
    stopTracks();
  }
  useEffect(() => {
    if (!locationOpen && !manualOpen) return;
    const root = dialog.current;
    root
      ?.querySelector<HTMLElement>("input, select, textarea, button")
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLocationOpen(false);
        setManualOpen(false);
      }
      if (event.key !== "Tab" || !root) return;
      const controls = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      dialogTrigger.current?.focus();
    };
  }, [locationOpen, manualOpen]);
  useEffect(() => {
    if (demoId) {
      const key = new URLSearchParams(window.location.hash.slice(1)).get("key");
      const join = key
        ? post(`/api/demo/sessions/${demoId}/join`, { key })
        : Promise.resolve();
      join
        .then(() => api(`/api/demo/sessions/${demoId}`))
        .then((d) => {
          setBin(d.bin);
          setMatch("demo");
          setGpsMessage("Demo asset · stage GPS ignored");
          setJoined(true);
          if (key) history.replaceState(null, "", location.pathname);
        })
        .catch((e) => {
          setError(e.message);
          cancelAttempt();
          setCamera("off");
        });
    }
    return () => {
      generation.current++;
      locationWatch.current++;
      locationRequest.current++;
      cameraRequest.current++;
      captureAbort.current?.abort();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (watchId.current !== null)
        navigator.geolocation?.clearWatch(watchId.current);
    };
  }, [demoId]);
  async function openCamera() {
    cancelAttempt();
    sessionStorage.removeItem("trashme_camera_off");
    const request = ++cameraRequest.current;
    captureTaken.current = false;
    capturedRef.current = null;
    setCaptured(null);
    setResult(null);
    setReceipt(null);
    setError("");
    setMessage("Show an item or a bin. A photo will be taken after 2 seconds.");
    setCaptureHint("Taking a photo in 2 seconds…");
    setCamera("opening");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      setError(
        "Camera access needs HTTPS or localhost. Open the secure site on your phone.",
      );
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      if (request !== cameraRequest.current || document.hidden) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      media.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (request !== cameraRequest.current || captureTaken.current) return;
          cancelAttempt();
          setCamera("off");
          setError("The camera stopped before taking a photo. Try again.");
        },
        { once: true },
      );
      if (video.current) {
        video.current.srcObject = media;
        let playbackTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            video.current.play(),
            new Promise<never>((_, reject) => {
              playbackTimeout = setTimeout(
                () => reject(new Error("Camera frame timeout")),
                5000,
              );
            }),
          ]);
        } finally {
          if (playbackTimeout) clearTimeout(playbackTimeout);
        }
      }
      if (request !== cameraRequest.current || document.hidden) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      setCamera("ready");
    } catch (e) {
      if (request !== cameraRequest.current) return;
      stopTracks();
      setCamera("denied");
      setError(
        (e as DOMException).name === "NotAllowedError"
          ? "Camera access is blocked. Allow it in browser settings, then retry."
          : "The camera could not start. Close other camera apps and try again.",
      );
    }
  }
  useEffect(() => {
    let initialCamera: ReturnType<typeof setTimeout> | undefined;
    if (cameraOff) sessionStorage.setItem("trashme_camera_off", "1");
    if (cameraOff || sessionStorage.getItem("trashme_camera_off")) {
      setCamera("off");
      setMessage("Take a photo when you’re ready.");
    } else initialCamera = setTimeout(() => void openCamera(), 0);
    const hide = () => {
      setVisible(!document.hidden);
      if (document.hidden) {
        cancelAttempt();
        setCamera(capturedRef.current ? "captured" : "off");
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", cancelAttempt);
    return () => {
      if (initialCamera) clearTimeout(initialCamera);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", cancelAttempt);
      stopTracks();
    };
  }, []);
  function selectBin(next: Bin | null, method: "auto" | "selected" | "demo") {
    binRef.current = next;
    matchRef.current = method;
    setBin(next);
    setMatch(method);
  }
  function locate(resetSelection = false) {
    if (demoId) return;
    if (resetSelection) selectBin(null, "auto");
    const watch = ++locationWatch.current;
    locationRequest.current++;
    if (!navigator.geolocation) {
      setGpsMessage("Location is unavailable on this device");
      return;
    }
    if (watchId.current !== null)
      navigator.geolocation.clearWatch(watchId.current);
    setGpsMessage("Finding your location…");
    watchId.current = navigator.geolocation.watchPosition(
      async (p) => {
        if (watch !== locationWatch.current) return;
        const request = ++locationRequest.current;
        const g = {
          point: [p.coords.longitude, p.coords.latitude] as Point,
          accuracy: p.coords.accuracy,
          locatedAt: new Date(p.timestamp).toISOString(),
        };
        gpsRef.current = g;
        setGps(g);
        setGpsMessage(
          `Your location · accurate to ${Math.round(g.accuracy)} m`,
        );
        try {
          const d = await api<{ bins: (Bin & { distance: number })[] }>(
            scoped(
              `/api/bins/nearby?lng=${g.point[0]}&lat=${g.point[1]}`,
              scope,
            ),
          );
          if (
            watch !== locationWatch.current ||
            request !== locationRequest.current
          )
            return;
          setOptions(d.bins);
          const id = autoMatch(d.bins, g.accuracy);
          if (matchRef.current === "auto") {
            selectBin(d.bins.find((b) => b.id === id) || null, "auto");
          }
          if (!id && matchRef.current === "auto") {
            setGpsMessage(
              d.bins.length
                ? "Your location found · confirm a nearby bin if reporting"
                : "Your location found · no registered bin nearby",
            );
          }
        } catch {
          if (
            watch !== locationWatch.current ||
            request !== locationRequest.current
          )
            return;
          if (matchRef.current === "auto") selectBin(null, "auto");
          setGpsMessage("Location found · nearby bins could not load");
        }
      },
      (error) => {
        if (watch !== locationWatch.current) return;
        locationRequest.current++;
        gpsRef.current = null;
        setGps(null);
        if (matchRef.current === "auto") selectBin(null, "auto");
        setGpsMessage(
          error.code === 1
            ? "Allow location access to find bins near you"
            : "Location unavailable · try again outdoors",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
  }
  useEffect(() => {
    if (!joined || demoId || !locationActive) return;
    locate();
    return () => {
      locationWatch.current++;
      locationRequest.current++;
      if (watchId.current !== null)
        navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [locationActive, joined, demoId]);
  useEffect(() => {
    if (!locationOpen || search.length < 2) return;
    let cancelled = false;
    const t = setTimeout(
      () =>
        api(scoped(`/api/bins?q=${encodeURIComponent(search)}&limit=12`, scope))
          .then((d) => {
            if (!cancelled)
              setOptions(d.bins.filter((b: Bin) => b.status === "Existing"));
          })
          .catch((e) => setError(e.message)),
      250,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, locationOpen, scope]);
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const fit = () => {
      const image = capturedRef.current;
      setFrameStyle(
        image
          ? containedFrame(
              root.clientWidth,
              root.clientHeight,
              image.width,
              image.height,
            )
          : {
              left: 0,
              top: 0,
              width: root.clientWidth,
              height: root.clientHeight,
            },
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    fit();
    return () => observer.disconnect();
  }, [captured?.width, captured?.height]);

  function capture(): Capture | null {
    const v = video.current,
      c = canvas.current,
      root = surface.current;
    if (!v || !c || !root || !v.videoWidth || v.readyState < 2) return null;
    const crop = cameraCrop(
      root.clientWidth,
      root.clientHeight,
      v.videoWidth,
      v.videoHeight,
    );
    if (!crop.width || !crop.height) return null;
    const scale = Math.min(1, 768 / Math.max(crop.width, crop.height));
    c.width = Math.max(1, Math.round(crop.width * scale));
    c.height = Math.max(1, Math.round(crop.height * scale));
    c.getContext("2d")!.drawImage(
      v,
      crop.left,
      crop.top,
      crop.width,
      crop.height,
      0,
      0,
      c.width,
      c.height,
    );
    return {
      image: c.toDataURL("image/jpeg", 0.78),
      capturedAt: Date.now(),
      width: c.width,
      height: c.height,
    };
  }
  async function runAnalysis(frame: Capture) {
    if (busy.current) return;
    busy.current = true;
    setAnalyzing(true);
    const current = ++generation.current,
      abort = new AbortController();
    captureAbort.current = abort;
    try {
      const response = await api<Result>(scoped("/api/scan", scope), {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify({
          image: frame.image,
          capturedAt: new Date(frame.capturedAt).toISOString(),
          mode: "auto",
          method: "camera",
        }),
      });
      if (current !== generation.current || abort.signal.aborted) return;
      setResult(response);
      setError("");
      setMessage(
        response.detection.overflow
          ? "Confirm this bin’s location to report the overflow."
          : response.detection.scene === "item"
            ? "Sort each visible part as shown."
            : response.detection.scene === "bin"
              ? "No visible overflow in this photo."
              : "Retake the photo with the item closer and in focus.",
      );
      if (response.detection.scene === "bin" && response.detection.overflow)
        openOverflowReport(frame, response.detection);
      // A single captured image is not the two independent observations required
      // by the automatic reporting endpoint. Residents can explicitly report it.
    } catch (e) {
      if (current !== generation.current || abort.signal.aborted) return;
      setError(
        e instanceof Error
          ? e.message
          : "The photo could not be analyzed. Retake it and try again.",
      );
    } finally {
      if (current === generation.current) {
        busy.current = false;
        captureAbort.current = null;
        setAnalyzing(false);
      }
    }
  }
  function openOverflowReport(frame: Capture, detection: Detection) {
    try {
      const draft = createReportDraft({
        image: frame.image,
        capturedAt: new Date(frame.capturedAt).toISOString(),
        initialBin: binRef.current,
        note: detection.evidence.join("; "),
        scope,
        returnTo: demoId
          ? `/demo/${demoId}/scan?camera=off`
          : "/scan?camera=off",
      });
      router.push(draft.href);
      return true;
    } catch {
      setError(
        "The report page could not open. You can still report this bin below.",
      );
      return false;
    }
  }
  function takePhoto() {
    if (
      captureTaken.current ||
      busy.current ||
      camera !== "ready" ||
      !visible ||
      document.hidden ||
      !joined
    )
      return;
    const frame = capture();
    if (!frame) {
      stopTracks();
      setCamera("off");
      setError(
        "The camera could not capture a frame. Try taking the photo again.",
      );
      return;
    }
    // Manual and automatic capture share one claim, so simultaneous actions
    // cannot produce two photos or analysis requests.
    captureTaken.current = true;
    capturedRef.current = frame;
    setCaptured(frame);
    stopTracks();
    setCamera("captured");
    void runAnalysis(frame);
  }
  useEffect(() => {
    if (
      !visible ||
      camera !== "ready" ||
      !joined ||
      captured ||
      captureTaken.current
    )
      return;
    let disposed = false;
    const request = cameraRequest.current;
    const active = () =>
      !disposed &&
      !captureTaken.current &&
      request === cameraRequest.current &&
      !document.hidden;
    setCaptureHint("Taking a photo in 2 seconds…");
    const countdown = setTimeout(() => {
      if (active()) setCaptureHint("Taking a photo in 1 second…");
    }, 1000);
    // Every ready camera attempt gets a fresh, fixed delay. Motion does not
    // affect this timer; only the final photo is read from the video.
    captureTimer.current = setTimeout(() => {
      captureTimer.current = null;
      if (active()) takePhoto();
    }, 2000);
    return () => {
      disposed = true;
      clearTimeout(countdown);
      if (captureTimer.current) clearTimeout(captureTimer.current);
      captureTimer.current = null;
    };
  }, [visible, camera, joined, captured]);

  function openManualReport(event?: React.MouseEvent<HTMLButtonElement>) {
    if (event) dialogTrigger.current = event.currentTarget;
    if (
      capturedRef.current &&
      result?.detection.scene === "bin" &&
      result.detection.overflow &&
      openOverflowReport(capturedRef.current, result.detection)
    )
      return;
    cancelAttempt();
    setCamera(capturedRef.current ? "captured" : "off");
    setManualOpen(true);
  }
  const tips = result?.guidance || [];
  const hasFeedback = Boolean(error || analyzing || result || receipt);
  const dashboard = demoId ? `/demo/${demoId}/dashboard` : "/dashboard";
  return (
    <div className="scanner-page scanner-automatic">
      <header className="scanner-header">
        <Brand href={dashboard} />
      </header>
      <div className={`scanner-layout ${hasFeedback ? "has-feedback" : ""}`}>
        <section className="camera-section">
          {demoId && (
            <div className="scanner-demo">
              DEMO SESSION · Selected Toronto asset · Reports stay separate
            </div>
          )}
          <div ref={surface} className="camera-surface">
            <video
              ref={video}
              muted
              playsInline
              autoPlay
              aria-label="Rear camera before capture"
              style={{ visibility: captured ? "hidden" : "visible" }}
            />
            <canvas ref={canvas} hidden />
            {captured && (
              <img
                src={captured.image}
                className="uploaded-preview"
                alt="Captured item or bin"
              />
            )}
            {!captured && camera !== "ready" && (
              <div className="camera-placeholder">
                <div className="camera-placeholder-icon">
                  <Camera size={42} strokeWidth={1.3} />
                </div>
                <h1>
                  {camera === "opening"
                    ? "Opening your camera…"
                    : camera === "off"
                      ? "Ready for a photo"
                      : "Camera access needed"}
                </h1>
                <p>
                  {camera === "opening"
                    ? "Allow the rear camera, then aim at your item."
                    : "Show an item to sort it, or a bin to report an issue."}
                </p>
                {camera !== "opening" && (
                  <button
                    type="button"
                    className="button orange"
                    onClick={() => void openCamera()}
                  >
                    <Camera size={16} />
                    {camera === "off" ? "Take a photo" : "Try the camera again"}
                  </button>
                )}
              </div>
            )}
            {!captured && camera === "ready" && (
              <>
                <div className="camera-frame-hint">{captureHint}</div>
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: 58,
                    transform: "translateX(-50%)",
                    zIndex: 6,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  <button
                    type="button"
                    className="button orange"
                    onClick={takePhoto}
                  >
                    <Camera size={17} aria-hidden="true" />
                    Capture photo
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label="Cancel capture"
                    title="Cancel capture"
                    onClick={() => {
                      cancelAttempt();
                      setCamera("off");
                    }}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      padding: 10,
                      background: "var(--paper)",
                      color: "var(--ink)",
                    }}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
            {captured && result && (
              <AROverlay
                detection={result.detection}
                guidance={tips}
                frame={frameStyle}
              />
            )}
            {(captured || camera === "denied" || camera === "unsupported") &&
              !receipt && (
                <button
                  type="button"
                  className="button"
                  aria-label="Retake photo"
                  title="Retake photo"
                  onClick={() => void openCamera()}
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    zIndex: 6,
                    minWidth: 44,
                    minHeight: 44,
                    padding: 10,
                    background: "var(--paper)",
                    color: "var(--ink)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <RotateCcw size={19} aria-hidden="true" />
                </button>
              )}
            {captured && (
              <div className="camera-frame-hint">
                {analyzing ? "Analyzing your photo…" : "Photo captured"}
              </div>
            )}
            {receipt && (
              <div className="saved-overlay" role="status">
                <span className="saved-check">
                  <Check size={32} />
                </span>
                <strong>
                  {receipt.duplicate ? "Already reported" : "Report saved"}
                </strong>
                <p>
                  {receipt.duplicate
                    ? "Your earlier report is already saved."
                    : "Community report saved in Bin There Done That."}
                </p>
                <span>REPORT #{shortId(receipt.report.id)}</span>
                <div>
                  <Link
                    href={`/receipts/${receipt.report.id}${receipt.recovery ? "#key=" + receipt.recovery : ""}`}
                  >
                    Private receipt <ArrowUpRight size={14} />
                  </Link>
                  <Link href={dashboard}>
                    View dashboard <ArrowRight size={14} />
                  </Link>
                </div>
                <button type="button" onClick={() => void openCamera()}>
                  Take another photo
                </button>
              </div>
            )}
          </div>
        </section>
        <aside className="scanner-assistant">
          {error && (
            <p className="scanner-status" role="alert">
              {error}
            </p>
          )}
          {(analyzing || result || receipt) && (
            <div className="scan-feedback" aria-live="polite">
              <span
                className={`feedback-icon ${result?.detection.overflow ? "alert" : ""}`}
              >
                {receipt ? (
                  <Check size={23} />
                ) : result?.detection.overflow ? (
                  <TriangleAlert size={23} />
                ) : (
                  <ScanLine size={23} />
                )}
              </span>
              <div>
                <span className="eyebrow">
                  {analyzing
                    ? "Analyzing photo"
                    : receipt
                      ? "Report saved"
                      : result?.detection.overflow
                        ? "Overflowing bin detected"
                        : result?.detection.scene === "item"
                          ? "Item detected"
                          : result?.detection.scene === "bin"
                            ? "Bin detected"
                            : "Photo result"}
                </span>
                <p>{message}</p>
              </div>
            </div>
          )}
          {tips.length > 0 && (
            <div className="guidance-list">
              {tips.map((item, i) => (
                <GuidanceCard key={i} item={item} number={i + 1} />
              ))}
            </div>
          )}
          {result?.detection.evidence.length ? (
            <div className="visible-evidence">
              <span className="eyebrow">VISIBLE EVIDENCE</span>
              {result.detection.evidence.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="button outlined full"
            onClick={openManualReport}
          >
            <MapPin size={16} />
            {result?.detection.overflow
              ? "Report this bin"
              : "Report an issue manually"}
          </button>
        </aside>
      </div>
      {locationOpen && (
        <div className="modal-backdrop">
          <div
            className="modal"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bin-picker-title"
          >
            <button
              className="modal-close"
              aria-label="Close bin picker"
              onClick={() => setLocationOpen(false)}
            >
              <X />
            </button>
            <h2 id="bin-picker-title">Which bin is this?</h2>
            <p>
              Choose the physical bin you’re looking at. GPS alone can be
              ambiguous on a busy street.
            </p>
            <div className="input-icon">
              <MapPin size={17} />
              <input
                autoFocus
                aria-label="Find a bin by street address or City ID"
                placeholder="Street address or City bin ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button className="text-button" onClick={() => locate(true)}>
              <LocateFixed size={15} />
              Find nearby bins
            </button>
            <div className="picker-list">
              {options.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    selectBin(b, "selected");
                    setLocationOpen(false);
                  }}
                >
                  <span>
                    <strong>{b.name}</strong>
                    <small>
                      {b.sourceId || "Community-added"} · {b.side || "Toronto"}
                      {b.distance !== undefined
                        ? ` · ${Math.round(b.distance)} m`
                        : ""}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
            <p className="muted small">
              Missing from the map?{" "}
              <Link href={scoped("/bins/new", scope)}>
                Add a bin with a photo.
              </Link>
            </p>
          </div>
        </div>
      )}
      {manualOpen && (
        <div className="modal-backdrop">
          <div
            className="modal"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-report-title"
          >
            <button
              className="modal-close"
              aria-label="Close manual report"
              onClick={() => {
                setManualOpen(false);
              }}
            >
              <X />
            </button>
            <h2 id="manual-report-title">What’s happening?</h2>
            <ManualReport
              scope={scope}
              initialBin={bin}
              image={captured?.image}
              capturedAt={
                captured
                  ? new Date(captured.capturedAt).toISOString()
                  : undefined
              }
              onSaved={(data) => {
                setReceipt(data);
                setManualOpen(false);
                setError("");
                setMessage("Your report is saved in Bin There Done That.");
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
function GuidanceCard({ item, number }: { item: Guidance; number?: number }) {
  const Icon =
    item.stream === "recycling"
      ? Recycle
      : item.stream === "organics"
        ? Leaf
        : item.stream === "garbage"
          ? Trash2
          : TriangleAlert;
  return (
    <article className={`guidance-card ${item.stream}`}>
      <span className="guidance-icon">
        <Icon size={20} />
      </span>
      <div>
        <span className="eyebrow">{guidanceLabel(item).toUpperCase()}</span>
        <h3>
          {number ? <span className="guidance-number">{number}</span> : null}
          {item.label}
        </h3>
      </div>
    </article>
  );
}
