import * as ort from "/vision-runtime/ort.webgpu.min.mjs";
import { letterbox, decodeYolo, decodeRfDetr } from "./core.mjs";

ort.env.wasm.wasmPaths = "/vision-runtime/";
ort.env.wasm.numThreads = 1; // Works without cross-origin isolation on mobile browsers.
ort.env.wasm.proxy = false;
let session, spec, inputBuffer, busy = false;
const send = (type, data = {}) => self.postMessage({ type, ...data });
const canvas = new OffscreenCanvas(1, 1);
const ctx = canvas.getContext("2d", { willReadFrequently: true });

function inputFor(bitmap) {
  const size = spec.size;
  if (canvas.width !== size) canvas.width = canvas.height = size;
  if (spec.decoder === "yolo-raw") {
    const pad = letterbox(bitmap.width, bitmap.height, size);
    ctx.fillStyle = "rgb(114,114,114)";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, pad.left, pad.top, pad.width, pad.height);
  } else ctx.drawImage(bitmap, 0, 0, size, size);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  const area = size * size, floats = inputBuffer;
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let i = 0; i < area; i++) for (let c = 0; c < 3; c++) {
    const value = rgba[i * 4 + c] / 255;
    floats[c * area + i] = spec.decoder === "rfdetr" ? (value - mean[c]) / std[c] : value;
  }
  return new ort.Tensor("float32", floats, [1, 3, size, size]);
}

async function load(id, forceCpu) {
  const started = performance.now();
  const response = await fetch(`/models/vision/${id}.json`);
  if (!response.ok) throw new Error("The model is missing. Prepare the model files, then retry.");
  spec = await response.json();
  inputBuffer = new Float32Array(3 * spec.size ** 2);
  send("progress", { phase: "download", loaded: 0, total: spec.bytes });
  const file = await fetch(spec.url, { cache: "force-cache" });
  if (!file.ok || !file.body) throw new Error("Model download failed. Check the connection and retry.");
  const reader = file.body.getReader(), buffer = new Uint8Array(spec.bytes);
  let loaded = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (loaded + value.length > buffer.length) throw new Error("Unexpected model size.");
    buffer.set(value, loaded); loaded += value.length;
    send("progress", { phase: "download", loaded, total: spec.bytes });
  }
  if (loaded !== spec.bytes) throw new Error("The model download was incomplete. Retry.");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), b => b.toString(16).padStart(2, "0")).join("");
  if (digest !== spec.sha256) throw new Error("The model file failed its integrity check. Reload and retry.");
  const downloadMs = performance.now() - started;
  send("progress", { phase: "initialize" });
  const initializedAt = performance.now();
  let runtime = "CPU (WebAssembly)", fallback = "";
  if (!forceCpu && self.navigator.gpu) {
    try {
      session = await ort.InferenceSession.create(buffer, { executionProviders: ["webgpu", "wasm"], graphOptimizationLevel: "all" });
      runtime = "WebGPU with CPU fallback";
    } catch {
      fallback = "GPU initialization failed; using CPU.";
    }
  }
  if (!session) session = await ort.InferenceSession.create(buffer, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const initializationMs = performance.now() - initializedAt;
  send("progress", { phase: "warmup", runtime });
  const warmedAt = performance.now();
  const zeros = new ort.Tensor("float32", new Float32Array(3 * spec.size ** 2), [1, 3, spec.size, spec.size]);
  try {
    const outputs = await session.run({ [spec.input]: zeros });
    Object.values(outputs).forEach(x => x.dispose());
  } finally { zeros.dispose(); }
  send("ready", { runtime, fallback, downloadMs, initializationMs, warmupMs: performance.now() - warmedAt, totalLoadMs: performance.now() - started, spec });
}

self.onmessage = async ({ data }) => {
  if (busy) { data.bitmap?.close(); return; }
  busy = true;
  let input, outputs;
  try {
    if (data.type === "load") await load(data.id, data.forceCpu);
    if (data.type === "infer") {
      if (!session) throw new Error("Load a model before scanning.");
      const started = performance.now(), { width, height } = data.bitmap;
      input = inputFor(data.bitmap);
      const preprocessedAt = performance.now();
      outputs = await session.run({ [spec.input]: input });
      const inferredAt = performance.now();
      const detections = spec.decoder === "yolo-raw"
        ? decodeYolo(outputs[session.outputNames[0]], width, height, spec.size, .4, spec.classNames)
        : decodeRfDetr(outputs.dets, outputs.labels);
      send("result", { requestId: data.requestId, detections, preprocessingMs: preprocessedAt - started, inferenceMs: inferredAt - preprocessedAt, decodingMs: performance.now() - inferredAt });
    }
  } catch (error) {
    send("error", { message: error instanceof Error ? error.message : "Detection failed.", requestId: data.requestId });
  } finally {
    data.bitmap?.close(); input?.dispose();
    if (outputs) Object.values(outputs).forEach(x => x.dispose());
    busy = false;
  }
};
