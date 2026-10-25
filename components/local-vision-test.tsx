"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, Square, Download, ScanLine, RotateCcw } from "lucide-react";
import { Brand } from "./ui";
import { cameraCrop, containedFrame, guidanceLabel } from "@/lib/ar";
import { track, percentile } from "@/public/vision/core.mjs";
import { api } from "@/lib/client";
import { createReportDraft } from "@/lib/report-draft";
import type { Detection } from "@/lib/types";
import { type CloudPreview } from "@/lib/cloud-preview";
import ManualReport, { type ReportReceipt } from "./manual-report";
import AROverlay from "./ar-overlay";
import { localLabel, localPreview, type LocalClass } from "@/lib/local-preview";
import styles from "./local-vision-test.module.css";

type Box = { x: number; y: number; width: number; height: number };
type Found = { label: string; score: number; box: Box; id: number };
type Sample = {
  totalMs: number;
  inferenceMs: number;
  preprocessingMs: number;
  decodingMs: number;
  source: "camera" | "photo";
  detected: string[];
  at: string;
};
type LoadInfo = {
  runtime: string;
  fallback: string;
  downloadMs: number;
  initializationMs: number;
  warmupMs: number;
  totalLoadMs: number;
  spec: { sha256: string; url: string; bytes: number; classMap?: LocalClass[] };
};
type Phase = "idle" | "download" | "initialize" | "warmup" | "ready" | "error";
const MODELS = {
  gemini: {
    name: "Gemini camera",
    description:
      "Identifies visible parts and shows their Toronto disposal instructions.",
  },
  yolo26n: {
    name: "YOLO26 Nano · general baseline",
    description: "10 MB · general objects; no trash-can category",
  },
  "rfdetr-nano": {
    name: "RF-DETR Nano · general baseline",
    description: "108 MB · general objects; no trash-can category",
  },
  "waste-yolo26n-v1": {
    name: "Trained waste detector · experimental",
    description: "First local training run · location and arrow preview",
  },
} as const;
const seconds = (ms: number | null | undefined) =>
  ms == null ? "—" : `${(ms / 1000).toFixed(2)} s`;

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

export default function LocalVisionTest() {
  const [modelId, setModelId] = useState<keyof typeof MODELS>("gemini");
  return modelId === "gemini" ? (
    <GeminiPreview />
  ) : (
    <LocalDetectorTest
      key={modelId}
      modelId={modelId}
      setModelId={setModelId}
    />
  );
}

function LocalDetectorTest({
  modelId,
  setModelId,
}: {
  modelId: Exclude<keyof typeof MODELS, "gemini">;
  setModelId: (value: keyof typeof MODELS) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<LoadInfo | null>(null);
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoSize, setPhotoSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ width: 1, height: 1 });
  const [found, setFound] = useState<Found[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [firstResponse, setFirstResponse] = useState<number | null>(null);
  const [emptyResult, setEmptyResult] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const loaderRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const epochRef = useRef(0);
  const requestRef = useRef<{
    id: number;
    started: number;
    epoch: number;
    source: "camera" | "photo";
    width: number;
    height: number;
  } | null>(null);
  const captureRef = useRef<HTMLCanvasElement | null>(null);
  const nextRequestRef = useRef(1);
  const tracksRef = useRef<{ tracks: Found[]; nextId: number }>({
    tracks: [],
    nextId: 1,
  });
  const cameraRef = useRef(false);
  const photoUrlRef = useRef<string | null>(null);
  const runStartedRef = useRef<number | null>(null);
  const firstFoundRef = useRef(false);
  const captureOnceRef = useRef<() => Promise<void>>(async () => {});
  const captureTimer = useTimedCapture(camera, () => captureOnceRef.current());

  function clearBoxes() {
    tracksRef.current = { tracks: [], nextId: 1 };
    setFound([]);
  }

  function stopSource() {
    epochRef.current++;
    cameraRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera(false);
    setStarting(false);
    setProcessing(false);
    clearBoxes();
  }

  function disposeWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    readyRef.current = false;
    loaderRef.current?.reject(new DOMException("Test cancelled", "AbortError"));
    loaderRef.current = null;
    requestRef.current = null;
  }

  function clearPhoto() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
    setPhoto(null);
  }

  function beginRun() {
    setSamples([]);
    setFirstResponse(null);
    firstFoundRef.current = false;
    runStartedRef.current = performance.now();
    setEmptyResult(false);
    clearBoxes();
  }

  function ensureReady(forceCpu = false): Promise<void> {
    if (readyRef.current) return Promise.resolve();
    if (loaderRef.current) return loaderRef.current.promise;
    if (
      typeof Worker === "undefined" ||
      typeof createImageBitmap === "undefined" ||
      typeof OffscreenCanvas === "undefined"
    )
      return Promise.reject(
        new Error(
          "This browser cannot run this local test. Try a current Safari or Chrome.",
        ),
      );
    setPhase("download");
    setError("");
    setProgress(0);
    const worker = new Worker("/vision/worker.mjs", {
      type: "module",
      name: "local-object-detection",
    });
    workerRef.current = worker;
    let resolve!: () => void, reject!: (e: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    loaderRef.current = { promise, resolve, reject };
    const fail = (message: string) => {
      if (workerRef.current !== worker) return;
      readyRef.current = false;
      setPhase("error");
      setError(message);
      stopSource();
      loaderRef.current?.reject(new Error(message));
      loaderRef.current = null;
      worker.terminate();
      workerRef.current = null;
      requestRef.current = null;
    };
    worker.onerror = () =>
      fail("The local model stopped. Retry using CPU, or try another browser.");
    worker.onmessage = ({ data }) => {
      if (workerRef.current !== worker) return;
      if (data.type === "progress") {
        setPhase(data.phase);
        if (data.total) setProgress(data.loaded / data.total);
      } else if (data.type === "ready") {
        readyRef.current = true;
        setInfo(data);
        setPhase("ready");
        loaderRef.current?.resolve();
        loaderRef.current = null;
      } else if (data.type === "error")
        fail("The model could not finish. Try CPU mode. " + data.message);
      else if (data.type === "result") {
        const pending = requestRef.current;
        requestRef.current = null;
        if (
          !pending ||
          pending.id !== data.requestId ||
          pending.epoch !== epochRef.current
        )
          return;
        // Both camera and file inputs are fixed images, so normalized boxes
        // remain aligned after a viewport resize or a slow inference response.
        tracksRef.current = track(
          tracksRef.current.tracks,
          data.detections,
          tracksRef.current.nextId,
        ) as typeof tracksRef.current;
        setFound(tracksRef.current.tracks);
        setProcessing(false);
        setEmptyResult(data.detections.length === 0);
        setError("");
        // Commit one animation frame before recording capture-to-display latency.
        requestAnimationFrame(() => {
          if (pending.epoch !== epochRef.current) return;
          const totalMs = performance.now() - pending.started;
          const sample: Sample = {
            totalMs,
            inferenceMs: data.inferenceMs,
            preprocessingMs: data.preprocessingMs,
            decodingMs: data.decodingMs,
            source: pending.source,
            detected: data.detections.map((d: Found) => d.label),
            at: new Date().toISOString(),
          };
          setSamples((old) => [...old.slice(-199), sample]);
          if (
            data.detections.length &&
            !firstFoundRef.current &&
            runStartedRef.current != null
          ) {
            firstFoundRef.current = true;
            setFirstResponse(performance.now() - runStartedRef.current);
          }
        });
      }
    };
    worker.postMessage({ type: "load", id: modelId, forceCpu });
    return promise;
  }

  async function infer(
    bitmap: ImageBitmap,
    source: "camera" | "photo",
    started: number,
    epoch: number,
  ) {
    // A stopped camera may still have one frame running. Drain it before a photo
    // test instead of dropping the photo or starting overlapping inference.
    if (source === "photo") {
      const waitingAt = performance.now();
      while (
        requestRef.current &&
        epoch === epochRef.current &&
        performance.now() - waitingAt < 5000
      )
        await new Promise((resolve) => setTimeout(resolve, 30));
      if (requestRef.current && epoch === epochRef.current) {
        bitmap.close();
        throw new Error(
          "The previous frame is still running. Retry the photo in a moment.",
        );
      }
    }
    if (
      !workerRef.current ||
      !readyRef.current ||
      requestRef.current ||
      epoch !== epochRef.current ||
      document.hidden
    ) {
      bitmap.close();
      return;
    }
    const id = nextRequestRef.current++;
    requestRef.current = {
      id,
      started,
      epoch,
      source,
      width: frameRef.current?.clientWidth ?? 0,
      height: frameRef.current?.clientHeight ?? 0,
    };
    workerRef.current.postMessage({ type: "infer", requestId: id, bitmap }, [
      bitmap,
    ]);
  }

  captureOnceRef.current = async () => {
    const video = videoRef.current,
      frame = frameRef.current;
    if (
      !cameraRef.current ||
      !video ||
      !frame ||
      requestRef.current ||
      document.hidden
    )
      return;
    if (!video.videoWidth || video.readyState < 2) {
      stopSource();
      setError("The camera could not capture a frame. Retake the photo.");
      return;
    }
    const epoch = epochRef.current,
      started = performance.now();
    const crop = cameraCrop(
      frame.clientWidth,
      frame.clientHeight,
      video.videoWidth,
      video.videoHeight,
    );
    const capture =
      captureRef.current ??
      (captureRef.current = document.createElement("canvas"));
    const scale = Math.min(1, 960 / Math.max(crop.width, crop.height));
    const width = Math.max(1, Math.round(crop.width * scale)),
      height = Math.max(1, Math.round(crop.height * scale));
    if (capture.width !== width || capture.height !== height) {
      capture.width = width;
      capture.height = height;
    }
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
    try {
      const bitmap = await createImageBitmap(capture);
      if (epoch !== epochRef.current) {
        bitmap.close();
        return;
      }
      setPhoto(capture.toDataURL("image/jpeg", 0.82));
      setPhotoSize({ width: capture.width, height: capture.height });
      cameraRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      video.srcObject = null;
      setCamera(false);
      setStarting(false);
      setProcessing(true);
      // The comparison model also runs once on a still, preserving its boxes.
      await infer(bitmap, "camera", started, epoch);
    } catch {
      stopSource();
      setError("Could not read a camera frame. Try a photo instead.");
    }
  };

  async function startCamera() {
    stopSource();
    clearPhoto();
    setError("");
    setStarting(true);
    const epoch = epochRef.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs HTTPS and a browser with camera support.",
        );
      await ensureReady();
      if (epoch !== epochRef.current || document.hidden) return;
      // Permission is requested only after the user explicitly takes a photo.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (epoch !== epochRef.current || document.hidden) {
        stream.getTracks().forEach((t) => t.stop());
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
          "The camera could not capture a frame. Retake the photo.",
        );
      cameraRef.current = true;
      setCamera(true);
      setStarting(false);
      beginRun();
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (epoch === epochRef.current && cameraRef.current) stopSource();
        },
        { once: true },
      );
      // The ready camera gets a fresh two-second countdown before one capture.
    } catch (e) {
      if (epoch !== epochRef.current) return;
      stopSource();
      setError(
        e instanceof Error && e.name !== "NotAllowedError"
          ? e.message
          : "Camera access was declined. Allow it in browser settings, then try again.",
      );
    }
  }

  async function choosePhoto(file?: File, forceCpu = false) {
    if (!file) return;
    stopSource();
    clearPhoto();
    setError("");
    setProcessing(true);
    const epoch = epochRef.current;
    try {
      const image = await createImageBitmap(file);
      if (epoch !== epochRef.current) {
        image.close();
        return;
      }
      const url = URL.createObjectURL(file);
      photoUrlRef.current = url;
      setPhoto(url);
      setPhotoSize({ width: image.width, height: image.height });
      // Bound mobile memory while preserving aspect ratio and overlay coordinates.
      const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
      const bitmap = await createImageBitmap(image, {
        resizeWidth: Math.max(1, Math.round(image.width * scale)),
        resizeHeight: Math.max(1, Math.round(image.height * scale)),
      });
      image.close();
      try {
        await ensureReady(forceCpu);
        if (epoch !== epochRef.current) {
          bitmap.close();
          return;
        }
        beginRun();
        await infer(bitmap, "photo", performance.now(), epoch);
      } catch (e) {
        bitmap.close();
        throw e;
      }
    } catch (e) {
      if (epoch !== epochRef.current) return;
      setProcessing(false);
      setError(
        e instanceof Error
          ? e.message
          : "Could not read this photo. Try a JPEG or PNG.",
      );
    }
  }

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setView({ width: r.width, height: r.height });
      if (cameraRef.current) clearBoxes();
    });
    if (frameRef.current) observer.observe(frameRef.current);
    const hide = () => {
      if (document.hidden) {
        stopSource();
        disposeWorker();
        setPhase("idle");
      }
    };
    const leave = () => {
      stopSource();
      disposeWorker();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      leave();
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  const frame = photo
    ? containedFrame(view.width, view.height, photoSize.width, photoSize.height)
    : { left: 0, top: 0, ...view };
  const custom = modelId === "waste-yolo26n-v1";
  const preview = localPreview(found, info?.spec.classMap);
  const visibleLabel = (label: string) =>
    custom ? localLabel(label, info?.spec.classMap) : label;
  const values = samples.map((s) => s.totalMs),
    p95 = percentile(values, 0.95),
    p50 = percentile(values, 0.5);
  const loading = ["download", "initialize", "warmup"].includes(phase);
  const status =
    phase === "download"
      ? `Downloading model · ${Math.round(progress * 100)}%`
      : phase === "initialize"
        ? "Preparing model…"
        : phase === "warmup"
          ? "Warming up…"
          : phase === "ready"
            ? "Model ready"
            : phase === "error"
              ? "Model needs a retry"
              : "Model not loaded";

  function exportResults() {
    const file = new Blob(
      [
        JSON.stringify(
          {
            model: modelId,
            modelHash: info?.spec.sha256,
            runtime: info?.runtime,
            browser: navigator.userAgent,
            capturedAt: new Date().toISOString(),
            load: info,
            sampleCount: samples.length,
            p50Ms: p50,
            p95Ms: p95,
            firstDetectionAfterReadyMs: firstResponse,
            samples,
            limitations: custom
              ? "First source-supervised waste detector. Not production-ready. Arrows indicate detected locations; material, disposal and overflow are not verified. This is not a phone accuracy guarantee."
              : "Pretrained COCO baseline. No custom waste or overflow model. Not an accuracy evaluation or guarantee of phone latency.",
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(file),
      a = document.createElement("a");
    a.href = url;
    a.download = `bin-there-${modelId}-benchmark.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <span>Phone model test</span>
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <h1>See what your phone can see.</h1>
          <p>
            Point at your item. A photo is taken after two seconds. Detection
            runs on this device.
          </p>
        </div>
        <div className={styles.workspace}>
          <section
            aria-label="Detection preview"
            className={styles.previewSection}
          >
            <div
              ref={frameRef}
              className={`${styles.frame} ${custom ? styles.arPreview : ""}`}
              aria-busy={loading || processing}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                className={styles.video}
                style={{ visibility: camera ? "visible" : "hidden" }}
              />
              {photo && (
                <img
                  src={photo}
                  alt="Your selected test photo"
                  className={styles.photo}
                />
              )}
              {!photo && !camera && (
                <div className={styles.empty}>
                  <ScanLine size={32} strokeWidth={1.5} aria-hidden="true" />
                  <h2>
                    {starting
                      ? "Opening your camera…"
                      : "Ready for a real test"}
                  </h2>
                  <p>
                    Start the camera to take a photo.
                    <br />
                    Images stay on your device.
                  </p>
                </div>
              )}
              {custom ? (
                <AROverlay
                  detection={preview.detection}
                  guidance={preview.guidance}
                  frame={frame}
                />
              ) : (
                <div className={styles.overlay} aria-hidden="true">
                  {found.map((d) => (
                    <div
                      key={d.id}
                      className={styles.box}
                      style={{
                        left: frame.left + d.box.x * frame.width,
                        top: frame.top + d.box.y * frame.height,
                        width: d.box.width * frame.width,
                        height: d.box.height * frame.height,
                      }}
                    >
                      <span>
                        {d.label} <small>{Math.round(d.score * 100)}%</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {camera && (
                <CaptureCountdown remainingMs={captureTimer.remainingMs} />
              )}
              {photo && <span className={styles.previewLabel}>Photo test</span>}
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
                  <button type="button" onClick={stopSource}>
                    <Square size={17} aria-hidden="true" />
                    Cancel
                  </button>
                </>
              ) : starting ? (
                <button type="button" onClick={stopSource}>
                  <Square size={17} aria-hidden="true" />
                  Stop camera
                </button>
              ) : processing || loading ? (
                <button
                  type="button"
                  onClick={() => {
                    stopSource();
                    disposeWorker();
                    clearPhoto();
                    setPhase("idle");
                    setInfo(null);
                  }}
                >
                  <Square size={17} aria-hidden="true" />
                  Cancel test
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primary}
                  aria-label={photo ? "Retake photo" : "Take photo"}
                  onClick={() => void startCamera()}
                >
                  {photo ? (
                    <RotateCcw size={18} aria-hidden="true" />
                  ) : (
                    <Camera size={18} aria-hidden="true" />
                  )}
                  {photo ? "Retake photo" : "Take photo"}
                </button>
              )}
            </div>
            <div className={styles.result} role="status" aria-live="polite">
              {found.length
                ? [...new Set(found.map((d) => visibleLabel(d.label)))].join(
                    " · ",
                  )
                : emptyResult
                  ? "No confident match in this frame. Try a closer, well-lit view."
                  : processing && !loading
                    ? "Looking at your photo…"
                    : camera
                      ? "Looking for objects…"
                      : "No camera images are uploaded or saved."}
            </div>
          </section>
          <aside className={styles.details} aria-label="Model and measurements">
            <div className={styles.model}>
              <label htmlFor="vision-model">Test model</label>
              <select
                id="vision-model"
                value={modelId}
                onChange={(e) => {
                  stopSource();
                  disposeWorker();
                  clearPhoto();
                  setModelId(e.target.value as keyof typeof MODELS);
                  setInfo(null);
                  setPhase("idle");
                  setSamples([]);
                  setFirstResponse(null);
                  setError("");
                }}
              >
                {Object.entries(MODELS).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p>{MODELS[modelId].description}</p>
              <div className={styles.status} role="status">
                {status}
              </div>
              {phase === "download" && (
                <progress
                  value={progress}
                  max={1}
                  aria-label="Model download"
                />
              )}
              {error && (
                <div className={styles.error} role="alert">
                  <p>{error}</p>
                  <button
                    type="button"
                    onClick={() => {
                      stopSource();
                      disposeWorker();
                      setInfo(null);
                      setError("");
                      void ensureReady(true).catch(() => {});
                    }}
                  >
                    Load using CPU
                  </button>
                </div>
              )}
            </div>
            <section
              className={styles.measurements}
              aria-labelledby="speed-heading"
            >
              <h2 id="speed-heading">Response time</h2>
              <p>Measured for this captured photo, after the model is ready.</p>
              <dl>
                <div>
                  <dt>This photo</dt>
                  <dd>{seconds(samples.at(-1)?.totalMs)}</dd>
                </div>
              </dl>
            </section>
            <details className={styles.technical}>
              <summary>Test details</summary>
              <p>
                {info?.runtime ?? "Runtime is selected when the model loads."}{" "}
                {info?.fallback}
              </p>
              <dl>
                <div>
                  <dt>Download & verification</dt>
                  <dd>{seconds(info?.downloadMs)}</dd>
                </div>
                <div>
                  <dt>Initialization</dt>
                  <dd>{seconds(info?.initializationMs)}</dd>
                </div>
                <div>
                  <dt>Warm-up</dt>
                  <dd>{seconds(info?.warmupMs)}</dd>
                </div>
                <div>
                  <dt>First detection after ready</dt>
                  <dd>{seconds(firstResponse)}</dd>
                </div>
                <div>
                  <dt>Latest inference only</dt>
                  <dd>{seconds(samples.at(-1)?.inferenceMs)}</dd>
                </div>
              </dl>
              <p>
                Frame times include capture, processing and delivery to the
                display. The first detection timer starts when the camera or
                photo test is ready; it cannot measure when you first held an
                object up. Download times depend on the connection and browser
                cache.
              </p>
            </details>
            <button
              type="button"
              className={styles.export}
              disabled={!samples.length}
              onClick={exportResults}
            >
              <Download size={16} aria-hidden="true" />
              Save test results
            </button>
          </aside>
        </div>
        <footer className={styles.note}>
          <strong>
            {custom ? "Experimental AR preview." : "Recognition test."}
          </strong>
          <p>
            {custom
              ? "This first trained detector misses and misidentifies objects. Arrows show detected locations; disposal and overflowing-bin detection are not verified. No reports are created here."
              : "Compare the general object models with the first trained waste detector. Neither provides verified material or overflowing-bin detection here. No reports are created."}
          </p>
        </footer>
      </main>
    </div>
  );
}

type CloudSample = {
  totalMs: number;
  analysisMs: number;
  source: "camera" | "photo";
  at: string;
  detected: string[];
};
type CapturedPhoto = {
  src: string;
  width: number;
  height: number;
  source: "camera" | "photo";
  capturedAt: string;
};

function GeminiPreview() {
  const router = useRouter();
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [view, setView] = useState({ width: 1, height: 1 });
  const [result, setResult] = useState<CloudPreview | null>(null);
  const [error, setError] = useState("");
  const [sample, setSample] = useState<CloudSample | null>(null);
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
    setSample(null);
    setError("");
    setShowReport(false);
    setReceipt(null);
  }

  async function recognize(
    photo: CapturedPhoto,
    started: number,
    epoch: number,
  ) {
    if (epoch !== epochRef.current || document.hidden || requestRef.current)
      return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    setError("");
    try {
      const response = await api<CloudPreview>("/api/vision/preview", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          image: photo.src,
          capturedAt: photo.capturedAt,
          mode: "auto",
          method: photo.source === "camera" ? "camera" : "upload",
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
      requestAnimationFrame(() => {
        if (epoch !== epochRef.current) return;
        setSample({
          totalMs: performance.now() - started,
          analysisMs: response.analysisMs,
          source: photo.source,
          at: new Date().toISOString(),
          detected: response.detection.components.map(
            (component) => component.label,
          ),
        });
      });
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
        returnTo: "/scan/test",
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
        source: "camera",
        capturedAt: new Date().toISOString(),
      };
      const started = performance.now();
      setCaptured(photo);
      releaseCamera();
      await recognize(photo, started, epoch);
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

  async function choosePhoto(file?: File) {
    if (!file) return;
    reset();
    setBusy(true);
    const epoch = epochRef.current,
      started = performance.now();
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Choose an image smaller than 8 MB.");
      const bitmap = await createImageBitmap(file);
      if (epoch !== epochRef.current || document.hidden) {
        bitmap.close();
        return;
      }
      const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
      const capture = document.createElement("canvas");
      capture.width = Math.max(1, Math.round(bitmap.width * scale));
      capture.height = Math.max(1, Math.round(bitmap.height * scale));
      capture
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, capture.width, capture.height);
      bitmap.close();
      const photo: CapturedPhoto = {
        src: capture.toDataURL("image/jpeg", 0.8),
        width: capture.width,
        height: capture.height,
        source: "photo",
        capturedAt: new Date().toISOString(),
      };
      setCaptured(photo);
      await recognize(photo, started, epoch);
    } catch (e) {
      if (epoch !== epochRef.current) return;
      setBusy(false);
      setError(
        e instanceof Error
          ? e.message
          : "Could not read this photo. Try a JPEG or PNG.",
      );
    }
  }

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
  function exportResults() {
    const file = new Blob(
      [
        JSON.stringify(
          {
            provider: "gemini",
            model: result?.model,
            browser: navigator.userAgent,
            sample,
            limitations:
              "One photo per scan, captured two seconds after the camera is ready. Reports require confirmation.",
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(file),
      a = document.createElement("a");
    a.href = url;
    a.download = "bin-there-gemini-result.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <span>Camera preview</span>
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <h1>Point. Sort. Done.</h1>
          <p>Point at an item or bin. A photo is taken after two seconds.</p>
        </div>
        <div className={styles.workspace}>
          <section
            aria-label="Gemini camera preview"
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
            {result && (
              <section
                className={styles.guidance}
                aria-label="Disposal guidance"
              >
                {result.guidance.length > 0 && (
                  <ol>
                    {result.guidance.map((item, index) => (
                      <li key={index}>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{guidanceLabel(item)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
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
          <aside className={styles.details} aria-label="Scan details">
            <section
              className={styles.measurements}
              aria-labelledby="speed-heading"
            >
              <h2 id="speed-heading">Response time</h2>
              <p>Measured for this photo, from capture to the result.</p>
              <dl>
                <div>
                  <dt>This scan</dt>
                  <dd>{seconds(sample?.totalMs)}</dd>
                </div>
              </dl>
            </section>
            <details className={styles.technical}>
              <summary>Scan details</summary>
              <p>
                {result?.model ??
                  "The server selects the connected Gemini model."}
              </p>
              <dl>
                <div>
                  <dt>Analysis</dt>
                  <dd>{seconds(sample?.analysisMs)}</dd>
                </div>
              </dl>
              <p>
                One photo is analyzed per scan. The result stays on that photo
                until you retake it.
              </p>
            </details>
            <button
              type="button"
              className={styles.export}
              disabled={!sample}
              onClick={exportResults}
            >
              <Download size={16} aria-hidden="true" />
              Save result
            </button>
          </aside>
        </div>
        <footer className={styles.note}>
          <strong>Sort each part.</strong>
          <p>
            Use recycling, organics or garbage as shown. Follow the posted
            labels at the bin.
          </p>
        </footer>
      </main>
    </div>
  );
}
