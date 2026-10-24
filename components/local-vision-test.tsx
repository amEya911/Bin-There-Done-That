"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Square, Download, ScanLine } from "lucide-react";
import { Brand } from "./ui";
import { cameraCrop, containedFrame } from "@/lib/ar";
import { track, percentile } from "@/public/vision/core.mjs";
import styles from "./local-vision-test.module.css";

type Box = { x: number; y: number; width: number; height: number };
type Found = { label: string; score: number; box: Box; id: number };
type Sample = { totalMs: number; inferenceMs: number; preprocessingMs: number; decodingMs: number; source: "camera" | "photo"; detected: string[]; at: string };
type LoadInfo = { runtime: string; fallback: string; downloadMs: number; initializationMs: number; warmupMs: number; totalLoadMs: number; spec: { sha256: string; url: string; bytes: number } };
type Phase = "idle" | "download" | "initialize" | "warmup" | "ready" | "error";
const MODELS = {
  yolo26n: { name: "YOLO26 Nano", description: "10 MB · lightweight baseline" },
  "rfdetr-nano": { name: "RF-DETR Nano", description: "108 MB · larger comparison" },
} as const;
const seconds = (ms: number | null | undefined) => ms == null ? "—" : `${(ms / 1000).toFixed(2)} s`;

export default function LocalVisionTest() {
  const [modelId, setModelId] = useState<keyof typeof MODELS>("yolo26n");
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
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const loaderRef = useRef<{ promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epochRef = useRef(0);
  const requestRef = useRef<{ id: number; started: number; epoch: number; source: "camera" | "photo"; width: number; height: number } | null>(null);
  const captureRef = useRef<HTMLCanvasElement | null>(null);
  const nextRequestRef = useRef(1);
  const tracksRef = useRef<{ tracks: Found[]; nextId: number }>({ tracks: [], nextId: 1 });
  const cameraRef = useRef(false);
  const photoUrlRef = useRef<string | null>(null);
  const runStartedRef = useRef<number | null>(null);
  const firstFoundRef = useRef(false);
  const nextFrameRef = useRef<() => Promise<void>>(async () => {});

  function clearBoxes() {
    tracksRef.current = { tracks: [], nextId: 1 };
    setFound([]);
    if (expiryRef.current) clearTimeout(expiryRef.current);
  }

  function stopSource() {
    epochRef.current++;
    cameraRef.current = false;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setCamera(false); setStarting(false); setProcessing(false);
    clearBoxes();
  }

  function disposeWorker() {
    workerRef.current?.terminate(); workerRef.current = null; readyRef.current = false;
    loaderRef.current?.reject(new DOMException("Test cancelled", "AbortError")); loaderRef.current = null;
    requestRef.current = null;
  }

  function clearPhoto() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null; setPhoto(null);
  }

  function beginRun() {
    setSamples([]); setFirstResponse(null); firstFoundRef.current = false;
    runStartedRef.current = performance.now(); setEmptyResult(false); clearBoxes();
  }

  function ensureReady(forceCpu = false): Promise<void> {
    if (readyRef.current) return Promise.resolve();
    if (loaderRef.current) return loaderRef.current.promise;
    if (typeof Worker === "undefined" || typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined")
      return Promise.reject(new Error("This browser cannot run this local test. Try a current Safari or Chrome."));
    setPhase("download"); setError(""); setProgress(0);
    const worker = new Worker("/vision/worker.mjs", { type: "module", name: "local-object-detection" });
    workerRef.current = worker;
    let resolve!: () => void, reject!: (e: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    loaderRef.current = { promise, resolve, reject };
    const fail = (message: string) => {
      if (workerRef.current !== worker) return;
      readyRef.current = false; setPhase("error"); setError(message); stopSource();
      loaderRef.current?.reject(new Error(message)); loaderRef.current = null;
      worker.terminate(); workerRef.current = null; requestRef.current = null;
    };
    worker.onerror = () => fail("The local model stopped. Retry using CPU, or try another browser.");
    worker.onmessage = ({ data }) => {
      if (workerRef.current !== worker) return;
      if (data.type === "progress") {
        setPhase(data.phase); if (data.total) setProgress(data.loaded / data.total);
      } else if (data.type === "ready") {
        readyRef.current = true; setInfo(data); setPhase("ready");
        loaderRef.current?.resolve(); loaderRef.current = null;
      } else if (data.type === "error") fail("The model could not finish. Try CPU mode. " + data.message);
      else if (data.type === "result") {
        const pending = requestRef.current;
        requestRef.current = null;
        const resized = pending?.source === "camera" && (pending.width !== frameRef.current?.clientWidth || pending.height !== frameRef.current?.clientHeight);
        if (!pending || pending.id !== data.requestId || pending.epoch !== epochRef.current || resized) {
          if (cameraRef.current) timerRef.current = setTimeout(() => void nextFrameRef.current(), 0);
          return;
        }
        const now = performance.now(), elapsed = now - pending.started;
        const fresh = pending.source === "photo" || elapsed <= 2000;
        tracksRef.current = track(tracksRef.current.tracks, fresh ? data.detections : [], tracksRef.current.nextId) as typeof tracksRef.current;
        setFound(tracksRef.current.tracks); setProcessing(false); setEmptyResult(data.detections.length === 0);
        if (!fresh) setError("This device took over 2 seconds. Try the smaller model or CPU mode.");
        else setError("");
        if (expiryRef.current) clearTimeout(expiryRef.current);
        if (pending.source === "camera") expiryRef.current = setTimeout(clearBoxes, 900);
        // Commit one animation frame before recording capture-to-display latency.
        requestAnimationFrame(() => {
          if (pending.epoch !== epochRef.current) return;
          const totalMs = performance.now() - pending.started;
          const sample: Sample = { totalMs, inferenceMs: data.inferenceMs, preprocessingMs: data.preprocessingMs, decodingMs: data.decodingMs, source: pending.source, detected: data.detections.map((d: Found) => d.label), at: new Date().toISOString() };
          setSamples(old => [...old.slice(-199), sample]);
          if (fresh && data.detections.length && !firstFoundRef.current && runStartedRef.current != null) {
            firstFoundRef.current = true; setFirstResponse(performance.now() - runStartedRef.current);
          }
          if (cameraRef.current) timerRef.current = setTimeout(() => void nextFrameRef.current(), Math.max(0, 150 - totalMs));
        });
      }
    };
    worker.postMessage({ type: "load", id: modelId, forceCpu });
    return promise;
  }

  async function infer(bitmap: ImageBitmap, source: "camera" | "photo", started: number, epoch: number) {
    // A stopped camera may still have one frame running. Drain it before a photo
    // test instead of dropping the photo or starting overlapping inference.
    if (source === "photo") {
      const waitingAt = performance.now();
      while (requestRef.current && epoch === epochRef.current && performance.now() - waitingAt < 5000)
        await new Promise(resolve => setTimeout(resolve, 30));
      if (requestRef.current && epoch === epochRef.current) { bitmap.close(); throw new Error("The previous frame is still running. Retry the photo in a moment."); }
    }
    if (!workerRef.current || !readyRef.current || requestRef.current || epoch !== epochRef.current || document.hidden) { bitmap.close(); return; }
    const id = nextRequestRef.current++;
    requestRef.current = { id, started, epoch, source, width: frameRef.current?.clientWidth ?? 0, height: frameRef.current?.clientHeight ?? 0 };
    workerRef.current.postMessage({ type: "infer", requestId: id, bitmap }, [bitmap]);
  }

  nextFrameRef.current = async () => {
    const video = videoRef.current, frame = frameRef.current;
    if (!cameraRef.current || !video || !frame || !video.videoWidth || requestRef.current || document.hidden) return;
    const epoch = epochRef.current, started = performance.now();
    const crop = cameraCrop(frame.clientWidth, frame.clientHeight, video.videoWidth, video.videoHeight);
    const capture = captureRef.current ?? (captureRef.current = document.createElement("canvas"));
    const scale = Math.min(1, 960 / Math.max(crop.width, crop.height));
    const width = Math.max(1, Math.round(crop.width * scale)), height = Math.max(1, Math.round(crop.height * scale));
    if (capture.width !== width || capture.height !== height) { capture.width = width; capture.height = height; }
    capture.getContext("2d")!.drawImage(video, crop.left, crop.top, crop.width, crop.height, 0, 0, capture.width, capture.height);
    try { await infer(await createImageBitmap(capture), "camera", started, epoch); }
    catch { stopSource(); setError("Could not read a camera frame. Try a photo instead."); }
  };

  async function startCamera() {
    stopSource(); clearPhoto(); setError(""); setStarting(true);
    const epoch = epochRef.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera access needs HTTPS and a browser with camera support.");
      // Permission is requested only after the user presses Start camera.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (epoch !== epochRef.current || document.hidden) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      await ensureReady();
      if (epoch !== epochRef.current || document.hidden) { stream.getTracks().forEach(t => t.stop()); return; }
      const video = videoRef.current!;
      video.srcObject = stream; await video.play();
      if (epoch !== epochRef.current) return;
      cameraRef.current = true; setCamera(true); setStarting(false); beginRun();
      stream.getVideoTracks()[0]?.addEventListener("ended", () => { if (epoch === epochRef.current) stopSource(); }, { once: true });
      void nextFrameRef.current();
    } catch (e) {
      if (epoch !== epochRef.current) return;
      stopSource(); setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Camera access was declined. Allow it in browser settings, or choose a photo.");
    }
  }

  async function choosePhoto(file?: File, forceCpu = false) {
    if (!file) return;
    stopSource(); clearPhoto(); setError(""); setProcessing(true);
    const epoch = epochRef.current;
    try {
      const image = await createImageBitmap(file);
      if (epoch !== epochRef.current) { image.close(); return; }
      const url = URL.createObjectURL(file); photoUrlRef.current = url; setPhoto(url);
      setPhotoSize({ width: image.width, height: image.height });
      // Bound mobile memory while preserving aspect ratio and overlay coordinates.
      const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
      const bitmap = await createImageBitmap(image, { resizeWidth: Math.max(1, Math.round(image.width * scale)), resizeHeight: Math.max(1, Math.round(image.height * scale)) });
      image.close();
      try {
        await ensureReady(forceCpu);
        if (epoch !== epochRef.current) { bitmap.close(); return; }
        beginRun(); await infer(bitmap, "photo", performance.now(), epoch);
      } catch (e) { bitmap.close(); throw e; }
    } catch (e) {
      if (epoch !== epochRef.current) return;
      setProcessing(false); setError(e instanceof Error ? e.message : "Could not read this photo. Try a JPEG or PNG.");
    }
  }

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const r = entries[0].contentRect; setView({ width: r.width, height: r.height });
      if (cameraRef.current) clearBoxes();
    });
    if (frameRef.current) observer.observe(frameRef.current);
    const hide = () => { if (document.hidden) { stopSource(); disposeWorker(); setPhase("idle"); } };
    const leave = () => { stopSource(); disposeWorker(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
    return () => {
      observer.disconnect(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave);
      leave(); if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  const frame = photo ? containedFrame(view.width, view.height, photoSize.width, photoSize.height) : { left: 0, top: 0, ...view };
  const values = samples.map(s => s.totalMs), p95 = percentile(values, .95), p50 = percentile(values, .5);
  const loading = ["download", "initialize", "warmup"].includes(phase);
  const status = phase === "download" ? `Downloading model · ${Math.round(progress * 100)}%` : phase === "initialize" ? "Preparing model…" : phase === "warmup" ? "Warming up…" : phase === "ready" ? "Model ready" : phase === "error" ? "Model needs a retry" : "Model not loaded";

  function exportResults() {
    const file = new Blob([JSON.stringify({ model: modelId, modelHash: info?.spec.sha256, runtime: info?.runtime, browser: navigator.userAgent, capturedAt: new Date().toISOString(), load: info, sampleCount: samples.length, p50Ms: p50, p95Ms: p95, firstDetectionAfterReadyMs: firstResponse, samples, limitations: "Pretrained COCO baseline. No custom waste or overflow model. Not an accuracy evaluation or guarantee of phone latency." }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = `bin-there-${modelId}-benchmark.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={styles.page}>
    <header className={styles.header}><Brand /><span>Phone model test</span></header>
    <main className={styles.main}>
      <div className={styles.heading}><h1>See what your phone can see.</h1><p>Point at a cup, bottle or another everyday object. Detection runs on this device.</p></div>
      <div className={styles.workspace}>
        <section aria-label="Detection preview" className={styles.previewSection}>
          <div ref={frameRef} className={styles.frame} aria-busy={loading || processing}>
            <video ref={videoRef} muted playsInline className={styles.video} style={{ visibility: camera ? "visible" : "hidden" }} />
            {photo && <img src={photo} alt="Your selected test photo" className={styles.photo} />}
            {!photo && !camera && <div className={styles.empty}><ScanLine size={32} strokeWidth={1.5} aria-hidden="true" /><h2>{starting ? "Opening your camera…" : "Ready for a real test"}</h2><p>Start the camera or choose a photo.<br />Images stay on your device.</p></div>}
            <div className={styles.overlay} aria-hidden="true">{found.map(d => <div key={d.id} className={styles.box} style={{ left: frame.left + d.box.x * frame.width, top: frame.top + d.box.y * frame.height, width: d.box.width * frame.width, height: d.box.height * frame.height }}><span>{d.label} <small>{Math.round(d.score * 100)}%</small></span></div>)}</div>
            {(camera || photo) && <span className={styles.previewLabel}>{photo ? "Photo test" : "Live camera"}</span>}
          </div>
          <div className={styles.actions}>
            {camera || starting ? <button type="button" onClick={stopSource}><Square size={17} aria-hidden="true" />Stop camera</button> : processing || loading ? <button type="button" onClick={() => { stopSource(); disposeWorker(); clearPhoto(); setPhase("idle"); setInfo(null); }}><Square size={17} aria-hidden="true" />Cancel test</button> : <button type="button" className={styles.primary} onClick={() => void startCamera()}><Camera size={18} aria-hidden="true" />Start camera</button>}
            <button type="button" onClick={() => inputRef.current?.click()} disabled={loading || processing || starting}><ImagePlus size={18} aria-hidden="true" />Choose photo</button>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a test photo" className={styles.file} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void choosePhoto(file); }} />
          </div>
          <div className={styles.result} role="status" aria-live="polite">{found.length ? [...new Set(found.map(d => d.label))].join(" · ") : emptyResult ? "No confident match in this frame. Try a closer, well-lit view." : processing && !loading ? "Looking at your photo…" : camera ? "Looking for objects…" : "No camera images are uploaded or saved."}</div>
        </section>
        <aside className={styles.details} aria-label="Model and measurements">
          <div className={styles.model}>
            <label htmlFor="vision-model">Test model</label>
            <select id="vision-model" value={modelId} onChange={e => { stopSource(); disposeWorker(); clearPhoto(); setModelId(e.target.value as keyof typeof MODELS); setInfo(null); setPhase("idle"); setSamples([]); setFirstResponse(null); setError(""); }}>
              {Object.entries(MODELS).map(([id, m]) => <option key={id} value={id}>{m.name}</option>)}
            </select>
            <p>{MODELS[modelId].description}</p>
            <div className={styles.status} role="status">{status}</div>
            {phase === "download" && <progress value={progress} max={1} aria-label="Model download" />}
            {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={() => { stopSource(); disposeWorker(); setInfo(null); setError(""); void ensureReady(true).catch(() => {}); }}>Load using CPU</button></div>}
          </div>
          <section className={styles.measurements} aria-labelledby="speed-heading">
            <h2 id="speed-heading">Response time</h2>
            <p>Measured on this device, after the model is ready.</p>
            <dl>
              <div><dt>Latest frame</dt><dd>{seconds(samples.at(-1)?.totalMs)}</dd></div>
              <div><dt>Typical response <small>(p50)</small></dt><dd>{seconds(p50)}</dd></div>
              <div><dt>Slower responses <small>(p95)</small></dt><dd>{seconds(p95)}</dd></div>
              <div><dt>Frames measured</dt><dd>{samples.length}</dd></div>
            </dl>
            <p className={styles.target}>{samples.length < 20 ? "Collect at least 20 frames to check the 2-second target." : p95! <= 2000 ? "p95 is under 2 seconds in this test." : "This test exceeds the 2-second target."}</p>
          </section>
          <details className={styles.technical}>
            <summary>Test details</summary>
            <p>{info?.runtime ?? "Runtime is selected when the model loads."} {info?.fallback}</p>
            <dl>
              <div><dt>Download & verification</dt><dd>{seconds(info?.downloadMs)}</dd></div>
              <div><dt>Initialization</dt><dd>{seconds(info?.initializationMs)}</dd></div>
              <div><dt>Warm-up</dt><dd>{seconds(info?.warmupMs)}</dd></div>
              <div><dt>First detection after ready</dt><dd>{seconds(firstResponse)}</dd></div>
              <div><dt>Latest inference only</dt><dd>{seconds(samples.at(-1)?.inferenceMs)}</dd></div>
            </dl>
            <p>Frame times include capture, processing and delivery to the display. The first detection timer starts when the camera or photo test is ready; it cannot measure when you first held an object up. Download times depend on the connection and browser cache.</p>
          </details>
          <button type="button" className={styles.export} disabled={!samples.length} onClick={exportResults}><Download size={16} aria-hidden="true" />Save test results</button>
        </aside>
      </div>
      <footer className={styles.note}><strong>Recognition test, before custom training.</strong><p>These models know 80 general object categories. They cannot yet identify overflowing bins, all waste parts or materials. Disposal arrows and automatic reporting will use the trained waste models and Toronto’s sorting rules. No reports are created here.</p></footer>
    </main>
  </div>;
}
