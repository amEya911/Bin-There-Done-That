import type { Detection, Guidance } from "./types";

export type CloudPreview = {
  detection: Detection;
  guidance: Guidance[];
  capturedAt: string;
  receivedAt: string;
  width: number;
  height: number;
  latencyMs: number;
  analysisMs: number;
  storageMs: 0;
  provider: "gemini";
  model: string;
};
