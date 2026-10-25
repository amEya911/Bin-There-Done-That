"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, Square, ScanLine, RotateCcw } from "lucide-react";
import { Brand } from "./ui";
import { cameraCrop, containedFrame } from "@/lib/ar";
import { api } from "@/lib/client";
import { createReportDraft } from "@/lib/report-draft";
import type { Detection, Guidance } from "@/lib/types";
import ManualReport, { type ReportReceipt } from "./manual-report";
import AROverlay from "./ar-overlay";
import styles from "./camera-scanner.module.css";

type CapturedPhoto = {
  src: string;
  width: number;
  height: number;
  capturedAt: string;
};
type CameraResult = { detection: Detection; guidance: Guidance[] };

const CAPTURE_DELAY_MS = 2000;

// Camera readiness is established by the caller. This timer does not inspect
// frames or motion; it claims exactly one photo, even if the phone is moving.
function useTimedCapture(
  active: boolean,
  onCapture: () => void | Promise<void>,
) {
  const [remainingMs, setRemainingMs] = useState(CAPTURE_DELAY_MS);
  const callback = useRef(onCapture);
  callback.current = onCapture;
  const claimed = useRef(false);

  function captureNow() {
    if (!active || claimed.current || document.hidden) return;
    claimed.current = true;
    void callback.current();
  }

  useEffect(() => {
    claimed.current = false;
    setRemainingMs(CAPTURE_DELAY_MS);
    if (!active) return;
    const started = performance.now();
    const progress = setInterval(() => {
      setRemainingMs(
        Math.max(0, CAPTURE_DELAY_MS - (performance.now() - started)),
      );
    }, 50);
    const shutter = setTimeout(() => {
      clearInterval(progress);
      if (claimed.current || document.hidden) return;
      claimed.current = true;
      setRemainingMs(0);
      void callback.current();
    }, CAPTURE_DELAY_MS);
    return () => {
      clearInterval(progress);
      clearTimeout(shutter);
    };
  }, [active]);

  return { remainingMs, captureNow };
}

function CaptureCountdown({ remainingMs }: { remainingMs: number }) {
  return (
    <div className={styles.captureCountdown} role="status" aria-live="polite">
      <span>Photo in {Math.max(1, Math.ceil(remainingMs / 1000))}…</span>
      <progress
        max={CAPTURE_DELAY_MS}
        value={CAPTURE_DELAY_MS - remainingMs}
        aria-label="Two-second capture countdown"
      />
    </div>
  );
}

export default function CameraScanner({
  cameraOff = false,
}: {
  cameraOff?: boolean;
}) {
  const router = useRouter();
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [view, setView] = useState({ width: 1, height: 1 });
  const [result, setResult] = useState<CameraResult | null>(null);
  const [error, setError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const epochRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const captureRef = useRef<HTMLCanvasElement | null>(null);
  const openingRef = useRef(false);
  const captureTimer = useTimedCapture(camera, capturePhoto);

  function releaseCamera() {
    openingRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera(false);
    setStarting(false);
  }

  function cancel() {
    epochRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    releaseCamera();
    setBusy(false);
  }

  function reset() {
    cancel();
    setCaptured(null);
    setResult(null);
    setError("");
    setShowReport(false);
    setReceipt(null);
  }

  async function recognize(photo: CapturedPhoto, epoch: number) {
    if (epoch !== epochRef.current || document.hidden || requestRef.current)
      return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    setError("");
    try {
      const response = await api<CameraResult>("/api/vision/preview", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          image: photo.src,
          capturedAt: photo.capturedAt,
          mode: "auto",
          method: "camera",
        }),
      });
      if (
        epoch !== epochRef.current ||
        controller.signal.aborted ||
        document.hidden
      )
        return;
      // Every result is attached to this exact still. It remains visible until
      // another explicit capture, even after a slow request or a viewport resize.
      setResult(response);
      if (response.detection.scene === "bin" && response.detection.overflow)
        openOverflowReport(photo, response.detection);
    } catch (e) {
      if (epoch !== epochRef.current) return;
      setError(
        controller.signal.aborted
          ? "This photo could not finish. Retake it to try again."
          : e instanceof Error
            ? e.message
            : "Could not analyze this photo. Retake it to try again.",
      );
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
      if (epoch === epochRef.current) setBusy(false);
    }
  }
  function openOverflowReport(photo: CapturedPhoto, detection: Detection) {
    try {
      const draft = createReportDraft({
        image: photo.src,
        capturedAt: photo.capturedAt,
        note: detection.evidence.join("; "),
        returnTo: "/scan?camera=off",
      });
      router.push(draft.href);
    } catch {
      setError(
        "The report page could not open. Confirm the bin below to report it.",
      );
      setShowReport(true);
    }
  }

  async function capturePhoto() {
    if (!openingRef.current || document.hidden) return;
    openingRef.current = false;
    const epoch = epochRef.current;
    try {
      const video = videoRef.current,
        frame = frameRef.current;
      if (!video || !frame || !video.videoWidth || video.readyState < 2)
        throw new Error(
          "The camera could not capture a clear frame. Retake the photo.",
        );
      const crop = cameraCrop(
        frame.clientWidth,
        frame.clientHeight,
        video.videoWidth,
        video.videoHeight,
      );
      if (!crop.width || !crop.height)
        throw new Error("The camera view is not ready. Retake the photo.");
      const capture =
        captureRef.current ??
        (captureRef.current = document.createElement("canvas"));
      const scale = Math.min(1, 768 / Math.max(crop.width, crop.height));
      capture.width = Math.max(1, Math.round(crop.width * scale));
      capture.height = Math.max(1, Math.round(crop.height * scale));
      capture
        .getContext("2d")!
        .drawImage(
          video,
          crop.left,
          crop.top,
          crop.width,
          crop.height,
          0,
          0,
          capture.width,
          capture.height,
        );
      const photo: CapturedPhoto = {
        src: capture.toDataURL("image/jpeg", 0.78),
        width: capture.width,
        height: capture.height,
        capturedAt: new Date().toISOString(),
      };
      setCaptured(photo);
      releaseCamera();
      await recognize(photo, epoch);
    } catch (error) {
      if (epoch !== epochRef.current) return;
      releaseCamera();
      setBusy(false);
      setError(
        error instanceof Error
          ? error.message
          : "Could not capture this view. Retake the photo.",
      );
    }
  }

  async function startCamera() {
    reset();
    try {
      sessionStorage.removeItem("trashme_camera_off");
    } catch {
      /* Camera use does not depend on browser storage. */
    }
    setStarting(true);
    openingRef.current = true;
    const epoch = epochRef.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs HTTPS and a browser with camera support.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (epoch !== epochRef.current || document.hidden) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      let playbackTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          video.play(),
          new Promise<never>((_, reject) => {
            playbackTimer = setTimeout(
              () =>
                reject(
                  new Error("The camera could not start. Retake the photo."),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        if (playbackTimer) clearTimeout(playbackTimer);
      }
      if (epoch !== epochRef.current || document.hidden) return;
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (epoch === epochRef.current && openingRef.current) {
            cancel();
            setError("The camera stopped. Retake the photo to try again.");
          }
        },
        { once: true },
      );
      const readyAt = performance.now();
      while (
        (!video.videoWidth || video.readyState < 2) &&
        epoch === epochRef.current &&
        performance.now() - readyAt < 5000
      )
        await new Promise((resolve) => setTimeout(resolve, 30));
      if (epoch !== epochRef.current || document.hidden) return;
      if (!video.videoWidth || video.readyState < 2)
        throw new Error(
          "The camera could not capture a clear frame. Retake the photo.",
        );
      setCamera(true);
      setStarting(false);
      // The ready camera gets a fresh two-second countdown before one capture.
    } catch (error) {
      if (epoch !== epochRef.current) return;
      releaseCamera();
      setBusy(false);
      setError(
        error instanceof Error && error.name !== "NotAllowedError"
          ? error.message
          : "Camera access was declined. Allow it in browser settings, then try again.",
      );
    }
  }

  useEffect(() => {
    let autoStart: ReturnType<typeof setTimeout> | undefined;
    let keepOff = cameraOff;
    try {
      if (cameraOff) sessionStorage.setItem("trashme_camera_off", "1");
      keepOff ||= sessionStorage.getItem("trashme_camera_off") === "1";
    } catch {
      /* Respect the explicit route flag when storage is blocked. */
    }
    if (keepOff) cancel();
    else
      autoStart = setTimeout(() => {
        if (!document.hidden) void startCamera();
      }, 0);
    return () => {
      if (autoStart) clearTimeout(autoStart);
    };
  }, [cameraOff]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setView({ width: rect.width, height: rect.height });
    });
    if (frameRef.current) observer.observe(frameRef.current);
    const hide = () => {
      if (document.hidden) cancel();
    };
    const leave = () => cancel();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  const frame = captured
    ? containedFrame(view.width, view.height, captured.width, captured.height)
    : { left: 0, top: 0, ...view };
  const reportEpoch = epochRef.current;
  const canReport =
    captured && result?.detection.scene === "bin" && result.detection.overflow;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <h1>Point. Sort. Done.</h1>
          <p>Point at an item or bin. A photo is taken after two seconds.</p>
        </div>
        <div className={styles.workspace}>
          <section
            aria-label="Camera scanner"
            className={styles.previewSection}
          >
            <div
              ref={frameRef}
              className={`${styles.frame} ${styles.arPreview}`}
              aria-busy={busy || starting}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                className={styles.video}
                style={{ visibility: camera ? "visible" : "hidden" }}
              />
              {captured && (
                <img
                  src={captured.src}
                  alt="Captured photo"
                  className={styles.photo}
                />
              )}
              {!captured && !camera && (
                <div className={styles.empty}>
                  <ScanLine size={32} strokeWidth={1.5} aria-hidden="true" />
                  <h2>
                    {starting ? "Opening your camera…" : "What goes where?"}
                  </h2>
                  <p>
                    {starting
                      ? "You’ll have two seconds to frame your photo."
                      : "Open the camera to take a photo."}
                  </p>
                </div>
              )}
              {result && captured && (
                <AROverlay
                  detection={result.detection}
                  guidance={result.guidance}
                  frame={frame}
                />
              )}
              {camera && (
                <CaptureCountdown remainingMs={captureTimer.remainingMs} />
              )}
              {captured && (
                <span className={styles.previewLabel}>Captured photo</span>
              )}
            </div>
            <div className={styles.actions}>
              {camera ? (
                <>
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={captureTimer.captureNow}
                  >
                    <Camera size={18} aria-hidden="true" />
                    Capture photo
                  </button>
                  <button type="button" onClick={cancel}>
                    <Square size={17} aria-hidden="true" />
                    Cancel
                  </button>
                </>
              ) : starting ? (
                <button type="button" onClick={cancel}>
                  <Square size={17} aria-hidden="true" />
                  Cancel capture
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primary}
                  aria-label={captured || error ? "Retake photo" : "Take photo"}
                  onClick={() => void startCamera()}
                >
                  {captured || error ? (
                    <RotateCcw size={18} aria-hidden="true" />
                  ) : (
                    <Camera size={18} aria-hidden="true" />
                  )}
                  {captured || error ? "Retake photo" : "Take photo"}
                </button>
              )}
            </div>
            <div className={styles.result} role="status" aria-live="polite">
              {error ||
                (busy
                  ? "Sorting your photo…"
                  : result
                    ? result.detection.target
                    : "Ready when you are.")}
            </div>
            {result &&
              (result.detection.scene === "bin" ||
                result.guidance.length === 0) && (
                <section
                  className={styles.guidance}
                  aria-label="Disposal guidance"
                >
                  {result.detection.scene === "bin" && (
                    <p>
                      {result.detection.overflow
                        ? "This bin is overflowing. Confirm its location to report it."
                        : "Bin detected. No visible overflow in this photo."}
                    </p>
                  )}
                  {result.detection.scene !== "bin" &&
                    result.guidance.length === 0 && (
                      <p>Retake the photo with the item closer and in focus.</p>
                    )}
                </section>
              )}
            {canReport && (
              <section
                className={styles.reportReview}
                aria-label="Report overflowing bin"
              >
                {receipt ? (
                  <div className={styles.reportSaved} role="status">
                    <h2>
                      {receipt.duplicate
                        ? "Report already saved"
                        : "Report saved"}
                    </h2>
                    <p>
                      {receipt.report.binName || `Bin ${receipt.report.binId}`}
                    </p>
                    <dl>
                      <div>
                        <dt>Report</dt>
                        <dd>{receipt.report.id}</dd>
                      </div>
                      <div>
                        <dt>Issue</dt>
                        <dd>
                          {receipt.report.issue === "overflowing"
                            ? "Overflowing bin"
                            : receipt.report.issue}
                        </dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{receipt.report.status}</dd>
                      </div>
                    </dl>
                    <div className={styles.reportLinks}>
                      <Link
                        href={`/receipts/${encodeURIComponent(receipt.report.id)}${receipt.recovery ? `#key=${encodeURIComponent(receipt.recovery)}` : ""}`}
                      >
                        View receipt ↗
                      </Link>
                      {receipt.report.binId && (
                        <Link
                          href={`/bins/${encodeURIComponent(receipt.report.binId)}`}
                        >
                          View bin details ↗
                        </Link>
                      )}
                    </div>
                  </div>
                ) : showReport ? (
                  <>
                    <div className={styles.reportHeading}>
                      <h2>Confirm the bin</h2>
                      <button
                        type="button"
                        onClick={() => setShowReport(false)}
                      >
                        Cancel report
                      </button>
                    </div>
                    <p>
                      The captured photo will be attached to your report. Check
                      the nearest bin or search for another.
                    </p>
                    <ManualReport
                      image={captured.src}
                      capturedAt={captured.capturedAt}
                      onSaved={(saved) => {
                        if (reportEpoch !== epochRef.current) return;
                        setReceipt(saved);
                        setShowReport(false);
                      }}
                    />
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() =>
                      openOverflowReport(captured, result.detection)
                    }
                  >
                    Report this bin
                  </button>
                )}
              </section>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
