"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  LocateFixed,
  MapPin,
  X,
  Check,
  ArrowUpRight,
  ArrowRight,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Trash2,
  Recycle,
  Leaf,
} from "lucide-react";
import { Brand, ErrorNote } from "./ui";
import AROverlay from "./ar-overlay";
import ManualReport from "./manual-report";
import {
  cameraCrop,
  liveResultUsable,
  sceneDifference,
  SCENE_CHANGE_THRESHOLD,
  LIVE_FRAME_MAX_AGE_MS,
  OVERLAY_LIFETIME_MS,
} from "@/lib/ar";
import { api, post, scoped, shortId } from "@/lib/client";
import { autoMatch, overlap } from "@/lib/geo";
import type { Bin, Detection, Guidance, Point } from "@/lib/types";
type Result = {
  id: string;
  detection: Detection;
  guidance: Guidance[];
  capturedAt: string;
  latencyMs: number;
  width: number;
  height: number;
  binIdAtCapture?: string | null;
};
type Capture = {
  image: string;
  capturedAt: number;
  sample?: Uint8ClampedArray;
};
type ReportPhase = "idle" | "first" | "choose_bin" | "saving" | "saved";
export default function Scanner({
  scope = "public",
  demoId,
  cameraOff = false,
}: {
  scope?: string;
  demoId?: string;
  cameraOff?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef(0),
    prior = useRef<Result | null>(null),
    saving = useRef(false),
    lastReported = useRef(""),
    busy = useRef(false),
    captureAbort = useRef<AbortController | null>(null),
    frameAt = useRef(0),
    surface = useRef<HTMLDivElement>(null),
    cameraRequest = useRef(0),
    watchId = useRef<number | null>(null),
    motionSample = useRef<Uint8ClampedArray | null>(null),
    overlaySample = useRef<Uint8ClampedArray | null>(null);
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null),
    pendingSample = useRef<Uint8ClampedArray | null>(null),
    pendingMoved = useRef(false),
    locationWatch = useRef(0),
    locationRequest = useRef(0);
  const [camera, setCamera] = useState<
      "opening" | "ready" | "denied" | "unsupported" | "off"
    >(cameraOff ? "off" : "opening"),
    [status, setStatus] = useState<any>(null),
    [running, setRunning] = useState(true),
    [visible, setVisible] = useState(true),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("Hold an item or a bin in view."),
    [analyzing, setAnalyzing] = useState(false),
    [reportPhase, setReportPhase] = useState<ReportPhase>("idle"),
    [gps, setGps] = useState<{
      point: Point;
      accuracy: number;
      locatedAt: string;
    } | null>(null),
    [gpsMessage, setGpsMessage] = useState("Location starts with the camera"),
    [bin, setBin] = useState<Bin | null>(null),
    [match, setMatch] = useState<"auto" | "selected" | "demo">("auto"),
    [locationOpen, setLocationOpen] = useState(false),
    [search, setSearch] = useState(""),
    [options, setOptions] = useState<(Bin & { distance?: number })[]>([]),
    [receipt, setReceipt] = useState<any>(null),
    [manualOpen, setManualOpen] = useState(false),
    [joined, setJoined] = useState(!demoId),
    [overlay, setOverlay] = useState(false),
    [frameStyle, setFrameStyle] = useState({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  const binRef = useRef(bin),
    gpsRef = useRef(gps),
    matchRef = useRef(match);
  const dialog = useRef<HTMLDivElement>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
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
        if (camera === "ready") setRunning(true);
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
  }, [locationOpen, manualOpen, camera]);
  binRef.current = bin;
  gpsRef.current = gps;
  matchRef.current = match;
  useEffect(() => {
    api("/api/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
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
        .catch((e) => setError(e.message));
    }
    return () => {
      generation.current++;
      locationWatch.current++;
      locationRequest.current++;
      cameraRequest.current++;
      captureAbort.current?.abort();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (watchId.current !== null)
        navigator.geolocation?.clearWatch(watchId.current);
    };
  }, [demoId]);
  async function openCamera() {
    sessionStorage.removeItem("trashme_camera_off");
    const request = ++cameraRequest.current;
    setCamera("opening");
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      setError(
        "Live camera needs HTTPS or localhost. Open this site through a secure address on your phone.",
      );
      return;
    }
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      if (request !== cameraRequest.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setCamera("ready");
      setRunning(true);
    } catch (e) {
      if (request !== cameraRequest.current) return;
      setCamera("denied");
      setError(
        (e as DOMException).name === "NotAllowedError"
          ? "Camera access is blocked. Allow camera access in your browser’s site settings, then retry."
          : "The camera could not start. Close other camera apps and try again.",
      );
    }
  }
  useEffect(() => {
    if (cameraOff) sessionStorage.setItem("trashme_camera_off", "1");
    if (cameraOff || sessionStorage.getItem("trashme_camera_off")) {
      setCamera("off");
      setRunning(false);
      setMessage("Camera is off. Turn it on when you’re ready.");
    } else openCamera();
    const fn = () => {
      setVisible(!document.hidden);
      if (document.hidden) {
        generation.current++;
        captureAbort.current?.abort();
        prior.current = null;
        setOverlay(false);
        setReportPhase("idle");
        setResult(null);
      }
    };
    document.addEventListener("visibilitychange", fn);
    return () => {
      document.removeEventListener("visibilitychange", fn);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  function selectBin(next: Bin | null, method: "auto" | "selected" | "demo") {
    if (binRef.current?.id !== next?.id) {
      generation.current++;
      captureAbort.current?.abort();
      prior.current = null;
      setResult(null);
      setOverlay(false);
      setReportPhase("idle");
      lastReported.current = "";
    }
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
    if (!joined || demoId || camera !== "ready") return;
    locate();
    return () => {
      locationWatch.current++;
      locationRequest.current++;
      if (watchId.current !== null)
        navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [camera, joined, demoId]);
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
    if (!surface.current) return;
    let previous = "";
    const fit = () => {
      const root = surface.current,
        v = video.current;
      if (!root || !v) return;
      const signature = [
        root.clientWidth,
        root.clientHeight,
        v.videoWidth,
        v.videoHeight,
      ].join(":");
      if (previous && previous !== signature) {
        generation.current++;
        captureAbort.current?.abort();
        prior.current = null;
        setOverlay(false);
        setResult(null);
        setReportPhase((p) => (p === "saving" || p === "saved" ? p : "idle"));
      }
      previous = signature;
      setFrameStyle({
        left: 0,
        top: 0,
        width: root.clientWidth,
        height: root.clientHeight,
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(surface.current);
    video.current?.addEventListener("loadedmetadata", fit);
    video.current?.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      video.current?.removeEventListener("loadedmetadata", fit);
      video.current?.removeEventListener("resize", fit);
    };
  }, [camera]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - frameAt.current > OVERLAY_LIFETIME_MS) setOverlay(false);
      if (
        prior.current &&
        Date.now() - Date.parse(prior.current.capturedAt) > 20_000
      ) {
        prior.current = null;
        setReportPhase((p) => (p === "first" ? "idle" : p));
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (camera !== "ready") return;
    const t = setInterval(() => {
      const v = video.current;
      if (!v || v.readyState < 2 || document.hidden) return;
      const pixels = sampleFrame(v);
      motionSample.current = pixels;
      if (
        pendingSample.current &&
        sceneDifference(pendingSample.current, pixels) > SCENE_CHANGE_THRESHOLD
      )
        pendingMoved.current = true;
      const base = overlaySample.current;
      if (base && sceneDifference(base, pixels) > SCENE_CHANGE_THRESHOLD) {
        setOverlay(false);
        prior.current = null;
        overlaySample.current = null;
        setResult(null);
        setReportPhase((p) => (p === "saving" || p === "saved" ? p : "idle"));
        setMessage("View changed. Hold the new item or bin steady.");
      }
    }, 220);
    return () => clearInterval(t);
  }, [camera]);
  function sampleFrame(source: CanvasImageSource) {
    sampleCanvas.current ??= document.createElement("canvas");
    const small = sampleCanvas.current;
    small.width = 16;
    small.height = 16;
    const ctx = small.getContext("2d", { willReadFrequently: true })!;
    const v = video.current,
      root = surface.current;
    if (source === v && v && root) {
      const crop = cameraCrop(
        root.clientWidth,
        root.clientHeight,
        v.videoWidth,
        v.videoHeight,
      );
      ctx.drawImage(
        source,
        crop.left,
        crop.top,
        crop.width,
        crop.height,
        0,
        0,
        16,
        16,
      );
    } else ctx.drawImage(source, 0, 0, 16, 16);
    return ctx.getImageData(0, 0, 16, 16).data;
  }
  function capture() {
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
    const scale = Math.min(1, 1280 / crop.width, 1280 / crop.height);
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
      sample: sampleFrame(c),
    };
  }
  async function saveAutomatic(a: Result, b: Result) {
    if (saving.current) return;
    const currentBin = binRef.current,
      g = gpsRef.current;
    if (!currentBin) {
      setReportPhase("choose_bin");
      setMessage(
        "Overflow detected. Choose the physical bin to save an automatic report.",
      );
      return;
    }
    const episodeKey =
      currentBin?.id || g!.point.map((n) => n.toFixed(4)).join(",");
    if (lastReported.current === episodeKey) return;
    saving.current = true;
    setReportPhase("saving");
    try {
      const d = await post(scoped("/api/reports", scope), {
        binId: currentBin?.id || null,
        location:
          matchRef.current === "auto" && g
            ? g.point
            : currentBin
              ? [currentBin.lng, currentBin.lat]
              : g!.point,
        accuracy: g?.accuracy ?? null,
        locatedAt: g?.locatedAt,
        matchMethod: demoId ? "demo" : currentBin ? matchRef.current : "pin",
        scanIds: [a.id, b.id],
        idempotencyKey: `camera:${a.id}:${b.id}`,
        source: "camera",
        issue: "overflowing",
        note: "",
      });
      lastReported.current = episodeKey;
      setReceipt(d);
      setReportPhase("saved");
      setMessage(
        d.duplicate
          ? "Already reported from this session."
          : "Overflow report saved in Bin There Done That.",
      );
      setRunning(false);
    } catch (e) {
      setError((e as Error).message);
      prior.current = null;
      setReportPhase("idle");
    } finally {
      saving.current = false;
    }
  }
  async function runAnalysis(frame: Capture) {
    if (busy.current) return;
    busy.current = true;
    setAnalyzing(true);
    const current = ++generation.current;
    const sampled = frame.sample;
    const targetBinId = binRef.current?.id || null;
    pendingSample.current = sampled || null;
    pendingMoved.current = false;
    const abort = new AbortController();
    captureAbort.current = abort;
    try {
      const r = await api<Result>(scoped("/api/scan", scope), {
        method: "POST",
        body: JSON.stringify({
          image: frame.image,
          capturedAt: new Date(frame.capturedAt).toISOString(),
          mode: "auto",
          method: "camera",
        }),
        signal: abort.signal,
      });
      if (current !== generation.current) return;
      if (
        !liveResultUsable(
          frame.capturedAt,
          Date.now(),
          pendingMoved.current,
          sceneDifference(
            sampled,
            video.current ? sampleFrame(video.current) : null,
          ),
        )
      ) {
        prior.current = null;
        setResult(null);
        setOverlay(false);
        setReportPhase("idle");
        setMessage("The view changed. Hold steady for a fresh check.");
        return;
      }
      r.binIdAtCapture = targetBinId;
      setResult(r);
      overlaySample.current = sampled || null;
      setOverlay(true);
      frameAt.current = Math.min(
        Date.now(),
        frame.capturedAt + LIVE_FRAME_MAX_AGE_MS - OVERLAY_LIFETIME_MS,
      );
      setError("");
      setMessage(r.detection.message);
      if (r.detection.scene === "bin" && r.detection.overflow) {
        const a = prior.current;
        if (
          a?.detection.overflow &&
          a.detection.box &&
          r.detection.box &&
          a.binIdAtCapture === targetBinId &&
          targetBinId === (binRef.current?.id || null) &&
          Date.parse(r.capturedAt) - Date.parse(a.capturedAt) <= 20_000 &&
          overlap(a.detection.box, r.detection.box) >= 0.45
        )
          await saveAutomatic(a, r);
        else {
          setReportPhase("first");
          setMessage(
            "First overflow observation. Hold the same bin steady for a second check.",
          );
        }
        prior.current = r;
      } else {
        prior.current = null;
        setReportPhase("idle");
      }
    } catch (e) {
      if (current !== generation.current) return;
      if ((e as Error).name !== "AbortError") {
        setError(
          "Scanning is unavailable right now. Try again later or report the issue manually.",
        );
        setRunning(false);
        api("/api/status")
          .then(setStatus)
          .catch(() => {});
        prior.current = null;
      }
    } finally {
      pendingSample.current = null;
      busy.current = false;
      setAnalyzing(false);
    }
  }
  useEffect(() => {
    if (
      !running ||
      !visible ||
      camera !== "ready" ||
      !status?.aiConnected ||
      !!status?.aiError ||
      !joined
    )
      return;
    let disposed = false,
      t: ReturnType<typeof setTimeout>;
    async function tick() {
      if (disposed) return;
      const image = capture();
      if (image) await runAnalysis(image);
      if (!disposed) t = setTimeout(tick, 2200);
    }
    t = setTimeout(tick, 700);
    return () => {
      disposed = true;
      clearTimeout(t);
    };
  }, [running, visible, camera, status?.aiConnected, status?.aiError, joined]);
  const tips = result?.guidance || [];
  const hasFeedback = Boolean(
    error || analyzing || result || receipt || reportPhase !== "idle",
  );
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
              aria-label="Live rear camera"
            />
            <canvas ref={canvas} hidden />
            {camera !== "ready" && (
              <div className="camera-placeholder">
                <div className="camera-placeholder-icon">
                  <Camera size={42} strokeWidth={1.3} />
                </div>
                <h1>
                  {camera === "opening"
                    ? "Opening your camera…"
                    : camera === "off"
                      ? "Camera is off"
                      : "Camera access needed"}
                </h1>
                <p>
                  {camera === "opening"
                    ? "Allow the rear camera when your browser asks. No microphone needed."
                    : camera === "off"
                      ? "Point at an item to sort it, or a bin to check it."
                      : "Enable camera access to identify waste and spot overflowing bins."}
                </p>
                {camera !== "opening" && (
                  <button className="button orange" onClick={openCamera}>
                    <Camera size={16} />
                    {camera === "off"
                      ? "Turn camera on"
                      : "Try the camera again"}
                  </button>
                )}
              </div>
            )}
            {camera === "ready" && (
              <>
                <div className="viewfinder">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="camera-frame-hint">
                  Point at an item or a public bin
                </div>
              </>
            )}
            {result && overlay && (
              <AROverlay
                detection={result.detection}
                guidance={tips}
                frame={frameStyle}
              />
            )}
            {receipt && (
              <div className="saved-overlay" role="status">
                <span className="saved-check">
                  <Check size={32} />
                </span>
                <strong>
                  {receipt.duplicate
                    ? "Already reported"
                    : receipt.report.source === "camera"
                      ? "Overflow reported"
                      : "Report saved"}
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
                <button
                  onClick={() => {
                    setReceipt(null);
                    setRunning(true);
                    setResult(null);
                    setReportPhase("idle");
                    prior.current = null;
                    lastReported.current = "";
                  }}
                >
                  Keep scanning
                </button>
              </div>
            )}
          </div>
          {(!receipt || receipt.report.source === "camera") &&
            (result?.detection.overflow || reportPhase !== "idle") && (
              <div
                className="overflow-progress"
                aria-label="Automatic overflow report progress"
              >
                <div className="overflow-progress-heading">
                  <span className="eyebrow">AUTOMATIC OVERFLOW REPORT</span>
                  <span>
                    {receipt ? "Saved" : !bin ? "Bin needed" : "Bin selected"}
                  </span>
                </div>
                <ol>
                  {["Observe", "Confirm", "Save"].map((label, i) => {
                    const completed =
                      reportPhase === "saved"
                        ? 3
                        : ["choose_bin", "saving"].includes(reportPhase)
                          ? 2
                          : reportPhase === "first"
                            ? 1
                            : 0;
                    return (
                      <li
                        key={label}
                        className={
                          i < completed
                            ? "complete"
                            : i === completed && analyzing
                              ? "active"
                              : ""
                        }
                      >
                        <span>
                          {i < completed ? <Check size={12} /> : i + 1}
                        </span>
                        {label}
                      </li>
                    );
                  })}
                </ol>
                <p>
                  {reportPhase === "saved"
                    ? "Your observation is saved. Open the dashboard to see it on the map."
                    : reportPhase === "saving"
                      ? "Saving both observations and updating the map…"
                      : reportPhase === "choose_bin"
                        ? "Two observations agree. Choose the physical bin, then scan again."
                        : reportPhase === "first"
                          ? "One observation found visible overflow. Keep the same bin steady."
                          : "Two matching live observations + the right bin. One saved report."}
                </p>
              </div>
            )}
          <p className="camera-privacy">
            <ShieldCheck size={13} />
            Selected images are sent for analysis. Video stays on your device.
          </p>
        </section>
        <aside className="scanner-assistant">
          {error && (
            <p className="scanner-status" role="alert">
              {error}
            </p>
          )}
          {(analyzing || result || receipt || reportPhase !== "idle") && (
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
                    ? "Checking the view"
                    : receipt
                      ? "Report saved"
                      : result?.detection.scene === "item"
                        ? "Item detected"
                        : result?.detection.scene === "bin"
                          ? "Bin detected"
                          : "Point at an item or bin"}
                </span>
                <p>{message}</p>
              </div>
            </div>
          )}
          {tips.length > 0 && (
            <div className="guidance-list">
              {tips.map((t, i) => (
                <GuidanceCard key={i} item={t} number={i + 1} />
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
            className="button outlined full"
            onClick={(event) => {
              dialogTrigger.current = event.currentTarget;
              generation.current++;
              captureAbort.current?.abort();
              prior.current = null;
              setRunning(false);
              setOverlay(false);
              setReportPhase("idle");
              setManualOpen(true);
            }}
          >
            <MapPin size={16} />
            Report an issue manually
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
                    prior.current = null;
                    setReportPhase("idle");
                    setResult(null);
                    setOverlay(false);
                    lastReported.current = "";
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
                if (camera === "ready") setRunning(true);
              }}
            >
              <X />
            </button>
            <h2 id="manual-report-title">What’s happening?</h2>
            <ManualReport
              scope={scope}
              initialBin={bin}
              onSaved={(data) => {
                setReceipt(data);
                setReportPhase("saved");
                setManualOpen(false);
                setRunning(false);
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
        <span className="eyebrow">
          {item.stream === "check"
            ? "MATERIAL NEEDS A CHECK"
            : item.stream.toUpperCase()}
        </span>
        <h3>
          {number ? <span className="guidance-number">{number}</span> : null}
          {item.label}
        </h3>
        <p>{item.instruction}</p>
        <a href={item.source} target="_blank" rel="noreferrer">
          {item.stream === "check"
            ? "Check Toronto Waste Wizard"
            : "Toronto disposal guidance"}{" "}
          <ArrowUpRight size={11} />
        </a>
      </div>
    </article>
  );
}
