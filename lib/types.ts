export type Point = [number, number];
export type Scope = string;
export type Bin = {
  id: string;
  sourceId?: string;
  sourceAttributes?: Record<string, unknown>;
  sourceUrl?: string;
  sourceVersion?: string;
  name: string;
  address: string;
  side?: string;
  ward?: string;
  lng: number;
  lat: number;
  source: "toronto" | "manual";
  status: "Existing" | "Temporarily Removed";
  approval: "approved" | "pending" | "rejected";
  areaId?: string;
  createdAt?: string;
  note?: string;
};
export type Area = {
  id: string;
  name: string;
  scope: string;
  active: boolean;
  polygon: Point[];
  createdAt: string;
};
export type Box = { x: number; y: number; width: number; height: number };
export type ComponentDetection = {
  label: string;
  item: string;
  material: string;
  materialBasis?: "observed" | "estimated";
  certainty: "high" | "medium" | "low";
  box: Box;
};
export type Detection = {
  scene: "bin" | "item" | "unrelated" | "uncertain";
  target: string;
  certainty: "high" | "medium" | "low";
  overflow: boolean;
  evidence: string[];
  components: ComponentDetection[];
  box: Box | null;
  quality: string[];
  message: string;
};
export type Guidance = {
  label: string;
  stream: "recycling" | "organics" | "garbage" | "check";
  instruction: string;
  source: string;
  reviewed: string;
  estimated?: boolean;
  material?: string;
  action?: "reuse";
  box?: Box;
};
export type Scan = {
  id: string;
  sessionId: string;
  scope: string;
  capturedAt: string;
  receivedAt: string;
  frameHash: string;
  perceptualHash: string;
  detection: Detection;
  mediaId: string;
  width: number;
  height: number;
  method: "camera" | "upload";
};
export type CaseState =
  | "observed"
  | "needs_review"
  | "ready"
  | "assigned"
  | "work_complete"
  | "rechecked"
  | "resolved"
  | "reopened";
export type Case = {
  id: string;
  issue?: string;
  binName?: string;
  binId: string | null;
  scope: string;
  state: CaseState;
  openedAt: string;
  updatedAt: string;
  owner?: string;
  condition: "overflowing" | "unknown" | "clear";
  previousId?: string;
  location: Point;
  actions: CaseAction[];
};
export type CaseAction = {
  id: string;
  type: string;
  at: string;
  actor: string;
  note: string;
  mediaId?: string;
};
export type Report = {
  id: string;
  caseId: string;
  binId: string | null;
  scope: string;
  sessionId: string;
  createdAt: string;
  capturedAt: string | null;
  source: "camera" | "manual" | "upload";
  issue: string;
  note: string;
  location: Point;
  accuracy: number | null;
  matchMethod: string;
  scanIds: string[];
  mediaId?: string;
  status: "active" | "withdrawn";
  idempotencyKey: string;
  recoveryHash: string;
};
export type PublicReport = Omit<
  Report,
  | "sessionId"
  | "recoveryHash"
  | "scanIds"
  | "idempotencyKey"
  | "accuracy"
  | "mediaId"
  | "location"
> & { location: Point; binName?: string; caseState?: CaseState };
export type Demo = {
  id: string;
  title: string;
  binId: string;
  createdAt: string;
  writeHash: string;
  expiresAt: string;
};
export type MapPoint = { binId: string | null; location: Point; count: number };
export type Summary = {
  mapPoints: MapPoint[];
  totalReports: number;
  historicalReports: number;
  activeCases: number;
  affectedBins: number;
  unmatched: number;
  reports: PublicReport[];
  cases: Case[];
  binCounts: Record<string, number>;
  newest: string | null;
};
