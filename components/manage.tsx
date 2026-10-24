"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  MapPin,
  Plus,
  Lock,
  LogOut,
  Copy,
  Download,
  Camera,
  Square,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  X,
} from "lucide-react";
import { Shell, PageHeading, ErrorNote, EmptyBin } from "./ui";
import {
  api,
  post,
  scoped,
  imageData,
  relative,
  shortId,
  stateLabels,
} from "@/lib/client";
import type { Area, Bin, Case, Point, Summary } from "@/lib/types";
import CaseReview from "./case-review";
const BinMap = dynamic(() => import("./bin-map"), { ssr: false });
export default function Manage({
  section = "bins",
  scope = "public",
}: {
  section?: "bins" | "cases" | "demo" | "setup";
  scope?: string;
}) {
  const [status, setStatus] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false);
  const [caseLogin, setCaseLogin] = useState(false);
  async function refreshStatus() {
    setStatus(await api("/api/status"));
  }
  useEffect(() => {
    refreshStatus().catch((e) => setError(e.message));
  }, []);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await post("/api/auth/login", { password });
      setPassword("");
      await refreshStatus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const titles = {
    bins: [
      "FILL IN THE GAPS",
      "Every bin belongs on the map.",
      "Register physical bins within an approved area. Review them before they appear publicly.",
    ],
    cases: [
      "FOLLOW THROUGH",
      "From noticed to rechecked.",
      "Review evidence, assign work and keep an honest record of what happened.",
    ],
    demo: [
      "A REAL CAMERA. A SHARED MOMENT.",
      "Make the connection visible.",
      "Create a private demo session. Fresh camera observations update its own dashboard.",
    ],
    setup: [
      "THE LITTLE DETAILS",
      "Connect your corner of the city.",
      "Set up Gemini and management access on the computer running Bin There Done That.",
    ],
  };
  const t = titles[section];
  if (section === "cases" && !status?.isAdmin && !caseLogin)
    return (
      <CaseReview
        scope={scope}
        canManage={Boolean(status?.adminConfigured)}
        onManage={() => setCaseLogin(true)}
      />
    );
  return (
    <Shell>
      <div className="topbar">
        <span>
          <span className="status-dot" /> LOCAL WORKSPACE{" "}
          <span className="slash">/</span> MANAGEMENT
        </span>
        {status?.isAdmin && (
          <button
            className="text-button"
            onClick={async () => {
              await post("/api/auth/logout", {});
              await refreshStatus();
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        )}
      </div>
      <PageHeading eyebrow={t[0]} title={t[1]} description={t[2]} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {message && (
        <div className="notice success" role="status">
          <Check size={16} />
          {message}
        </div>
      )}
      {!status ? (
        <div className="panel">Opening the workspace…</div>
      ) : section === "setup" ? (
        <Setup
          status={status}
          onUpdate={refreshStatus}
          setError={setError}
          setMessage={setMessage}
        />
      ) : !status.adminConfigured ? (
        <div className="panel auth-panel">
          <ShieldCheck size={36} />
          <h2>A little setup first.</h2>
          <p>
            Choose a management password on localhost before managing bins,
            reviewing cases or creating demos.
          </p>
          <Link href="/setup" className="button primary">
            Open setup <ArrowRight size={16} />
          </Link>
        </div>
      ) : !status.isAdmin ? (
        <form className="panel auth-panel" onSubmit={login}>
          <Lock size={32} />
          <h2>Management access</h2>
          <p>Sign in with the password configured on this computer.</p>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="button primary" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
      ) : section === "bins" ? (
        <BinManagement setError={setError} setMessage={setMessage} />
      ) : section === "cases" ? (
        <CaseManagement
          setError={setError}
          setMessage={setMessage}
          scope={scope}
        />
      ) : (
        <DemoManagement setError={setError} />
      )}
    </Shell>
  );
}
function Setup({
  status,
  onUpdate,
  setError,
  setMessage,
}: {
  status: any;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
  setMessage: (s: string) => void;
}) {
  const [apiKey, setApiKey] = useState(""),
    [model, setModel] = useState(status.model),
    [password, setPassword] = useState(""),
    [loginPassword, setLoginPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/settings", {
        apiKey,
        model,
        password: password || undefined,
      });
      setApiKey("");
      setPassword("");
      setMessage(
        "Connection settings saved locally. Test the connection before scanning.",
      );
      await onUpdate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (status.adminConfigured && !status.isAdmin)
    return (
      <form
        className="panel auth-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post("/api/auth/login", { password: loginPassword });
            await onUpdate();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <Lock size={30} />
        <h2>Sign in to change connections</h2>
        <label>
          Password
          <input
            type="password"
            value={loginPassword}
            autoComplete="current-password"
            onChange={(e) => setLoginPassword(e.target.value)}
            required
          />
        </label>
        <button className="button primary">
          Sign in <ArrowRight size={16} />
        </button>
      </form>
    );
  return (
    <div className="setup-grid">
      <form className="panel" onSubmit={save}>
        <span className="section-number">01 / CAMERA INTELLIGENCE</span>
        <h2>A real look at real things.</h2>
        <p>
          Gemini analyzes selected images. Your key stays on this server, in
          ignored local storage, and is never returned to the browser.
        </p>
        <div className="connection-status">
          <span
            className={`status-dot ${status.aiConnected ? "" : "muted-dot"}`}
          />
          {status.aiConnected
            ? "Gemini key saved · not yet verified here"
            : "Gemini is not connected"}
        </div>
        <label>
          Gemini API key
          <input
            type="password"
            autoComplete="off"
            placeholder={
              status.aiConnected
                ? "Leave blank to keep the saved key"
                : "Enter your key from Google AI Studio"
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <small>
            <a
              href="https://aistudio.google.com/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              Get a key in Google AI Studio <ArrowUpRight size={12} />
            </a>
          </small>
        </label>
        <label>
          Vision model
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            required
          />
        </label>
        <label>
          {status.adminConfigured
            ? "New management password (optional)"
            : "Choose a management password"}
          <input
            type="password"
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!status.adminConfigured}
          />
          <small>
            At least 12 characters. Used for bin approval, case actions and demo
            setup.
          </small>
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Save local settings"}
          <ArrowRight size={16} />
        </button>
        {status.aiConnected && (
          <button
            type="button"
            className="button outlined"
            onClick={async () => {
              setError("");
              try {
                const d = await post("/api/settings/test", {});
                setMessage(
                  `Connection verified: ${d.model}. Run a real camera scan next.`,
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <RefreshCw size={15} />
            Test connection
          </button>
        )}
      </form>
      <div className="setup-aside">
        <div className="panel">
          <span className="section-number">02 / DURABLE LOCAL DATA</span>
          <h3>Your project, on this computer.</h3>
          <p>
            The working app uses SQLite for reports, cases, areas and settings.
            Data survives restarts in the ignored <code>.data/</code> directory.
          </p>
          <div className="mini-fact">
            <Check size={16} />
            Toronto inventory imported
          </div>
          <div className="mini-fact">
            <Check size={16} />
            Local persistence ready
          </div>
          <div className="mini-fact">
            <Check size={16} />
            Seven-day evidence retention
          </div>
          <p className="small muted">
            Run <code>npm run db:backup</code> before moving the project. This
            version requires a server with a persistent disk; it is not ready
            for ephemeral serverless hosting.
          </p>
        </div>
        <div className="panel warm-panel">
          <span className="section-number">03 / ON YOUR PHONE</span>
          <h3>The camera needs HTTPS.</h3>
          <p>
            Localhost works on this computer. A phone needs a trusted HTTPS
            address that reaches this same server. Use that address when
            creating a demo QR code.
          </p>
          <p className="small">
            Set <code>APP_ORIGIN</code> in <code>.env.local</code> to that HTTPS
            origin and restart. No site has been published automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
function BinManagement({
  setError,
  setMessage,
}: {
  setError: (s: string) => void;
  setMessage: (s: string) => void;
}) {
  const [areas, setAreas] = useState<Area[]>([]),
    [pending, setPending] = useState<Bin[]>([]),
    [point, setPoint] = useState<Point | null>(null),
    [areaId, setAreaId] = useState("downtown-pilot"),
    [name, setName] = useState(""),
    [address, setAddress] = useState(""),
    [note, setNote] = useState(""),
    [approval, setApproval] = useState("pending"),
    [duplicates, setDuplicates] = useState<Bin[]>([]),
    [tab, setTab] = useState("register"),
    [zoneName, setZoneName] = useState(""),
    [drawing, setDrawing] = useState(false),
    [corner, setCorner] = useState<Point | null>(null),
    [polygon, setPolygon] = useState<Point[] | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    setAreas(await api("/api/areas"));
    const d = await api("/api/bins?pending=true&limit=200");
    setPending(d.bins.filter((b: Bin) => b.source === "manual"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!point) return;
    const timer = setTimeout(
      () =>
        api(`/api/bins/nearby?lng=${point[0]}&lat=${point[1]}`)
          .then((d) =>
            setDuplicates(d.bins.filter((b: any) => b.distance <= 15)),
          )
          .catch((e) => setError(e.message)),
      250,
    );
    return () => clearTimeout(timer);
  }, [point?.[0], point?.[1]]);
  async function pick(p: Point) {
    if (drawing) {
      if (!corner) {
        setCorner(p);
        setMessage("First corner set. Click the opposite corner.");
      } else {
        const r: Point[] = [
          [Math.min(p[0], corner[0]), Math.min(p[1], corner[1])],
          [Math.max(p[0], corner[0]), Math.min(p[1], corner[1])],
          [Math.max(p[0], corner[0]), Math.max(p[1], corner[1])],
          [Math.min(p[0], corner[0]), Math.max(p[1], corner[1])],
          [Math.min(p[0], corner[0]), Math.min(p[1], corner[1])],
        ];
        setPolygon(r);
        setDrawing(false);
        setCorner(null);
        setMessage("Area boundary selected. Name and save it.");
      }
      return;
    }
    setPoint(p);
    try {
      const d = await api(`/api/bins/nearby?lng=${p[0]}&lat=${p[1]}`);
      setDuplicates(d.bins.filter((b: any) => b.distance <= 15));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveBin(e: React.FormEvent) {
    e.preventDefault();
    if (!point) {
      setError("Place a pin on the map first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await post("/api/bins", {
        name,
        address,
        lng: point[0],
        lat: point[1],
        areaId,
        status: "Existing",
        approval,
        note,
      });
      setMessage(
        approval === "approved"
          ? "Community bin approved and added to matching and the map."
          : "Bin saved for review. Pending bins stay out of public matching.",
      );
      setName("");
      setAddress("");
      setNote("");
      setPoint(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-tabs">
        {[
          ["register", "Register a bin"],
          ["review", "Review additions"],
          ["areas", "Designated areas"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "review" ? (
        <div className="panel">
          <h2>Community-added inventory</h2>
          {!pending.length ? (
            <div className="empty-state">
              <EmptyBin small />
              <p>No manual additions yet.</p>
            </div>
          ) : (
            pending.map((b) => (
              <div className="review-row" key={b.id}>
                <div>
                  <strong>{b.name}</strong>
                  <p>
                    {b.address} · {b.approval}
                  </p>
                  <small>{b.note || "No review note"}</small>
                </div>
                <button
                  className="button outlined"
                  onClick={async () => {
                    try {
                      await api("/api/bins/" + b.id, {
                        method: "PATCH",
                        body: JSON.stringify({
                          approval:
                            b.approval === "approved" ? "rejected" : "approved",
                          note:
                            b.approval === "approved"
                              ? "Removed from public inventory after operator review."
                              : "Physical bin and designated area reviewed by local operator.",
                        }),
                      });
                      setMessage("Review decision saved.");
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {b.approval === "approved" ? "Reject / hide" : "Approve bin"}
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="management-grid">
          <div className="manage-map">
            <BinMap
              onPick={pick}
              pin={point}
              areas={
                polygon
                  ? [
                      ...areas,
                      {
                        id: "draft",
                        name: "Draft",
                        scope: "public",
                        active: true,
                        polygon,
                        createdAt: "",
                      },
                    ]
                  : areas
              }
            />
            <div className="map-instruction">
              <MapPin size={17} />
              {drawing
                ? corner
                  ? "Click the opposite corner"
                  : "Click the first corner of the area"
                : "Click the map to place a bin pin"}
            </div>
          </div>
          {tab === "register" ? (
            <form className="panel bin-form" onSubmit={saveBin}>
              <h2>Add the missing piece.</h2>
              <p>
                Register an existing physical bin, not a proposed future
                placement.
              </p>
              <label>
                Designated area
                <select
                  value={areaId}
                  onChange={(e) => setAreaId(e.target.value)}
                >
                  {areas
                    .filter((a) => a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="coordinate-inputs">
                <label>
                  Longitude
                  <input
                    type="number"
                    step="any"
                    value={point?.[0] ?? ""}
                    onChange={(e) =>
                      setPoint([Number(e.target.value), point?.[1] || 43.65])
                    }
                    required
                  />
                </label>
                <label>
                  Latitude
                  <input
                    type="number"
                    step="any"
                    value={point?.[1] ?? ""}
                    onChange={(e) =>
                      setPoint([point?.[0] || -79.39, Number(e.target.value)])
                    }
                    required
                  />
                </label>
              </div>
              <label>
                Recognizable name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="South entrance bin"
                  required
                  minLength={3}
                />
              </label>
              <label>
                Address / landmark
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Outside the south entrance, east side"
                  required
                  minLength={3}
                />
              </label>
              {duplicates.length > 0 && (
                <div className="notice">
                  <strong>
                    {duplicates.length} nearby bin(s) within 15 m.
                  </strong>
                  <p>{duplicates.map((b) => b.name).join(", ")}</p>
                  <p>A second bin cannot be added at this location.</p>
                </div>
              )}
              <label>
                Review note
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What was checked?"
                />
              </label>
              <label>
                Initial review decision
                <select
                  value={approval}
                  onChange={(e) => setApproval(e.target.value)}
                >
                  <option value="pending">Pending review</option>
                  <option value="approved">Approved by me</option>
                </select>
              </label>
              <button
                className="button primary full"
                disabled={busy || duplicates.length > 0}
              >
                <Plus size={17} />
                {busy ? "Saving…" : "Register physical bin"}
              </button>
              <p className="small muted">
                Boundary and duplicate checks also run on the server. City IDs
                are never invented for community additions.
              </p>
            </form>
          ) : (
            <div className="panel">
              <h2>Give additions a boundary.</h2>
              <p>
                Manual bins are accepted only inside an active designated
                polygon, including its boundary.
              </p>
              <label>
                Area name
                <input
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder="Waterfront pilot"
                />
              </label>
              <button
                className="button outlined full"
                onClick={() => {
                  setDrawing(true);
                  setCorner(null);
                  setPolygon(null);
                }}
              >
                <Square size={16} />
                Draw a rectangle on the map
              </button>
              {polygon && (
                <div className="notice">
                  Four corners selected · public space
                </div>
              )}
              <button
                className="button primary full"
                disabled={!polygon || zoneName.length < 3}
                onClick={async () => {
                  try {
                    await post("/api/areas", { name: zoneName, polygon });
                    setMessage("Designated area saved.");
                    setPolygon(null);
                    setZoneName("");
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Save designated area <Check size={16} />
              </button>
              <div className="area-list">
                {areas.map((a) => (
                  <div key={a.id}>
                    <span className="status-dot" />
                    <strong>{a.name}</strong>
                    <small>
                      {a.active ? "Active" : "Inactive"} · {a.scope}
                    </small>
                  </div>
                ))}
              </div>
              <p className="small muted">
                Custom polygons are accepted by <code>POST /api/areas</code>.
                Self-intersecting polygons are rejected.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
function CaseManagement({
  setError,
  setMessage,
  scope,
}: {
  setError: (s: string) => void;
  setMessage: (s: string) => void;
  scope: string;
}) {
  const [associateId, setAssociateId] = useState(""),
    [binSearch, setBinSearch] = useState(""),
    [binResults, setBinResults] = useState<Bin[]>([]),
    [correction, setCorrection] = useState("merge"),
    [targetId, setTargetId] = useState(""),
    [reportId, setReportId] = useState(""),
    [correctionNote, setCorrectionNote] = useState("");
  const [cases, setCases] = useState<Case[]>([]),
    [detail, setDetail] = useState<any>(null),
    [type, setType] = useState("needs_review"),
    [note, setNote] = useState(""),
    [owner, setOwner] = useState(""),
    [image, setImage] = useState<string | undefined>(),
    [busy, setBusy] = useState(false);
  async function load() {
    const d = await api<Summary>(scoped("/api/dashboard?window=all", scope));
    setCases(d.cases);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [scope]);
  useEffect(() => {
    if (binSearch.length < 2) return;
    const t = setTimeout(
      () =>
        api(
          scoped(
            "/api/bins?q=" + encodeURIComponent(binSearch) + "&limit=5",
            scope,
          ),
        )
          .then((d) => setBinResults(d.bins))
          .catch((e) => setError(e.message)),
      200,
    );
    return () => clearTimeout(t);
  }, [binSearch, scope]);
  async function open(id: string) {
    try {
      setDetail(await api(scoped("/api/cases/" + id, scope)));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function action(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(scoped(`/api/cases/${detail.case.id}/actions`, scope), {
        type,
        note,
        owner,
        image,
        binId: associateId || undefined,
      });
      setNote("");
      setImage(undefined);
      await open(detail.case.id);
      await load();
      setMessage("Case action saved to the audit trail.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function handoff() {
    try {
      const data = await api(
        scoped(`/api/cases/${detail.case.id}/handoff`, scope),
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trashme-handoff-${shortId(detail.case.id)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        "Handoff packet downloaded. No request has been sent to Toronto 311.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="cases-layout">
      <div className="panel cases-list">
        <h2>
          Case queue <span className="count-pill">{cases.length}</span>
        </h2>
        {cases.length === 0 ? (
          <div className="empty-state">
            <EmptyBin />
            <h3>Nothing in the queue yet.</h3>
            <p>New observations will appear here.</p>
          </div>
        ) : (
          cases.map((c) => (
            <button
              className={`case-list-row ${detail?.case.id === c.id ? "selected" : ""}`}
              key={c.id}
              onClick={() => open(c.id)}
            >
              <span className="eyebrow">CASE #{shortId(c.id)}</span>
              <strong>{c.binName || "Unmatched location"}</strong>
              <small>
                {stateLabels[c.state]} · {relative(c.updatedAt)}
              </small>
            </button>
          ))
        )}
      </div>
      {!detail ? (
        <div className="panel case-placeholder">
          <MapPin size={34} />
          <h2>Every observation has a story.</h2>
          <p>Select a case to review its evidence and next steps.</p>
        </div>
      ) : (
        <div className="panel case-detail">
          <div className="case-detail-title">
            <div>
              <span className="eyebrow">CASE #{shortId(detail.case.id)}</span>
              <h2>{stateLabels[detail.case.state]}</h2>
            </div>
            <span className="pill">
              {detail.reports.filter((r: any) => r.status === "active").length}{" "}
              sightings
            </span>
          </div>
          <div className="truth-grid">
            <div>
              <small>DELIVERY</small>
              <strong>Saved in Bin There Done That</strong>
              <span>Not sent to 311</span>
            </div>
            <div>
              <small>WORK</small>
              <strong>{detail.case.owner || "Unassigned"}</strong>
              <span>{stateLabels[detail.case.state]}</span>
            </div>
            <div>
              <small>CONDITION</small>
              <strong>{detail.case.condition}</strong>
              <span>Based on recorded evidence</span>
            </div>
          </div>
          <div className="evidence-grid">
            {detail.reports.map((r: any) => (
              <div key={r.id}>
                {r.mediaId && (
                  <img
                    src={"/api/media/" + r.mediaId}
                    alt="Private observation evidence"
                  />
                )}
                <strong>
                  {r.issue} · {r.source}
                </strong>
                <small>
                  {new Date(r.createdAt).toLocaleString()} · {r.status}
                </small>
                {r.note && <p>{r.note}</p>}
              </div>
            ))}
          </div>
          <h3>Keep the record moving.</h3>
          <form onSubmit={action}>
            <label>
              Action
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="needs_review">Needs review</option>
                <option value="associate">
                  Associate with the correct bin
                </option>
                <option value="ready">Ready for handoff (not submitted)</option>
                <option value="assign">Assign to an operator</option>
                <option value="work_complete">Work marked complete</option>
                <option value="recheck">Record clear condition recheck</option>
                <option value="reopen">Reopen / dispute</option>
              </select>
            </label>
            {type === "assign" && (
              <label>
                Operator
                <input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  required
                />
              </label>
            )}
            {type === "associate" && (
              <div>
                <label>
                  Find the physical bin
                  <input
                    value={binSearch}
                    onChange={(e) => setBinSearch(e.target.value)}
                    placeholder="Street address or City ID"
                  />
                </label>
                <div className="picker-list">
                  {binResults.map((b) => (
                    <button
                      type="button"
                      key={b.id}
                      className={associateId === b.id ? "selected" : ""}
                      onClick={() => setAssociateId(b.id)}
                    >
                      <span>
                        <strong>{b.name}</strong>
                        <small>{b.sourceId || "Community-added"}</small>
                      </span>
                      {associateId === b.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label>
              What changed?
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                minLength={3}
              />
            </label>
            {["work_complete", "recheck"].includes(type) && (
              <label>
                Fresh follow-up photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  onChange={async (e) => {
                    try {
                      setImage(
                        e.target.files?.[0]
                          ? await imageData(e.target.files[0])
                          : undefined,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
                <small>
                  Recorded as operator evidence. An operator recheck does not
                  prove independent verification.
                </small>
              </label>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save case action"}
              <Check size={16} />
            </button>
          </form>
          <div className="handoff-actions">
            <button className="button outlined" onClick={handoff}>
              <Download size={16} />
              Download handoff packet
            </button>
            <a
              className="text-button"
              href="https://www.toronto.ca/home/311-toronto-at-your-service/"
              target="_blank"
              rel="noreferrer"
            >
              Open Toronto 311 <ExternalLink size={14} />
            </a>
          </div>
          <details className="case-correction">
            <summary>Correct how observations are grouped</summary>
            <p className="small muted">
              Use this after checking the evidence. Merging requires the same
              physical bin. A split preserves a separate episode.
            </p>
            <label>
              Correction
              <select
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
              >
                <option value="merge">Merge into another case</option>
                <option value="split">
                  Split one observation into a new case
                </option>
              </select>
            </label>
            {correction === "merge" ? (
              <label>
                Target case
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">Choose another case…</option>
                  {cases
                    .filter(
                      (c) =>
                        c.id !== detail.case.id &&
                        c.binId === detail.case.binId,
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.binName || "Unmatched"} · {stateLabels[c.state]} ·{" "}
                        {shortId(c.id)}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <label>
                Observation to split
                <select
                  value={reportId}
                  onChange={(e) => setReportId(e.target.value)}
                >
                  <option value="">Choose an observation…</option>
                  {detail.reports.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {shortId(r.id)} · {new Date(r.createdAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Reason
              <textarea
                value={correctionNote}
                onChange={(e) => setCorrectionNote(e.target.value)}
                minLength={12}
              />
            </label>
            <button
              className="button outlined"
              disabled={
                correctionNote.length < 12 ||
                (correction === "merge" ? !targetId : !reportId)
              }
              onClick={async () => {
                try {
                  const r = await post(
                    scoped(`/api/cases/${detail.case.id}/${correction}`, scope),
                    { targetId, reportId, note: correctionNote },
                  );
                  await load();
                  await open(r.caseId);
                  setMessage("Grouping correction saved with its audit trail.");
                  setCorrectionNote("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Save grouping correction
            </button>
          </details>
          <h3>Evidence timeline</h3>
          <div className="timeline">
            {[...detail.case.actions].reverse().map((a: any) => (
              <div key={a.id}>
                <i />
                <span>
                  <strong>{a.type.replaceAll("_", " ")}</strong>
                  <p>{a.note}</p>
                  <small>
                    {a.actor} · {new Date(a.at).toLocaleString()}
                  </small>
                  {a.mediaId && (
                    <img
                      src={"/api/media/" + a.mediaId}
                      alt="Private follow-up evidence"
                    />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function DemoManagement({ setError }: { setError: (s: string) => void }) {
  const [query, setQuery] = useState(""),
    [bins, setBins] = useState<Bin[]>([]),
    [bin, setBin] = useState<Bin | null>(null),
    [title, setTitle] = useState("Bin There Done That · live camera demo"),
    [origin, setOrigin] = useState(""),
    [demo, setDemo] = useState<any>(null),
    [qr, setQr] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    if (query.length < 2) return;
    const t = setTimeout(
      () =>
        api("/api/bins?q=" + encodeURIComponent(query) + "&limit=6")
          .then((d) =>
            setBins(d.bins.filter((b: Bin) => b.status === "Existing")),
          )
          .catch((e) => setError(e.message)),
      250,
    );
    return () => clearTimeout(t);
  }, [query]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!bin)
        throw new Error(
          "Choose the Toronto bin represented in this demonstration.",
        );
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Use a valid HTTP or HTTPS app address.");
      const d = await post("/api/demo/sessions", { title, binId: bin.id });
      const link = `${url.origin}/demo/${d.id}/scan#key=${d.writeKey}`;
      const QR = (await import("qrcode")).default;
      setQr(
        await QR.toDataURL(link, {
          width: 260,
          margin: 2,
          color: { dark: "#20251c", light: "#ffffff" },
        }),
      );
      setDemo({ ...d, link, origin: url.origin });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="setup-grid">
      <form className="panel" onSubmit={create}>
        <span className="section-number">01 / SELECT THE CONTEXT</span>
        <h2>Real detection. Clear context.</h2>
        <p>
          The phone will analyze fresh camera frames. This session supplies the
          Toronto bin identity, so stage GPS is never mistaken for the
          photographed location.
        </p>
        <label>
          Session title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label>
          Find a Toronto bin
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a street or City ID"
          />
        </label>
        <div className="picker-list">
          {bins.map((b) => (
            <button
              type="button"
              key={b.id}
              className={bin?.id === b.id ? "selected" : ""}
              onClick={() => setBin(b)}
            >
              <span>
                <strong>{b.name}</strong>
                <small>
                  {b.sourceId} · {b.side} side
                </small>
              </span>
              {bin?.id === b.id ? <Check size={17} /> : <MapPin size={17} />}
            </button>
          ))}
        </div>
        {bin && (
          <div className="notice success">
            <Check size={16} />
            Selected: {bin.name}
          </div>
        )}
        <label>
          App address reachable by your phone
          <input
            type="url"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            required
          />
          <small>
            A phone needs trusted HTTPS. Localhost only works on this computer.
          </small>
        </label>
        <button className="button primary full">
          Create isolated demo <ArrowRight size={16} />
        </button>
        <p className="small muted">
          Sessions expire after 24 hours. This creates no reports and no
          preloaded detections.
        </p>
      </form>
      <div className="panel demo-result">
        {!demo ? (
          <>
            <Camera size={40} />
            <h2>
              The little moment
              <br />
              that connects it all.
            </h2>
            <ol>
              <li>Create the demo with a selected Toronto bin.</li>
              <li>Open a real overflow photo in the presentation view.</li>
              <li>Scan the private QR link with your phone.</li>
              <li>
                Point at the projected photo. Two live observations create one
                demo report.
              </li>
              <li>Watch the separate dashboard update.</li>
            </ol>
            <p className="small muted">
              Recognition of a displayed photo does not establish real-world
              location accuracy. Test your actual phone and display before
              presenting.
            </p>
          </>
        ) : (
          <>
            <span className="eyebrow">02 / PHONE → CAMERA → DASHBOARD</span>
            <h2>Ready for a real scan.</h2>
            <img
              className="demo-qr"
              src={qr}
              alt="Private QR link to the demo camera scanner"
            />
            <p className="small">
              Keep the private scanner link with your presentation team.
            </p>
            <button
              className="button outlined"
              onClick={() =>
                navigator.clipboard
                  .writeText(demo.link)
                  .catch(() =>
                    setError(
                      "Clipboard unavailable. Copy the scanner link below.",
                    ),
                  )
              }
            >
              <Copy size={15} />
              Copy private scanner link
            </button>
            <a className="button outlined" href={demo.link}>
              Open demo scanner <ArrowUpRight size={16} />
            </a>
            <Link className="button primary" href={`/demo/${demo.id}/present`}>
              Open presentation <ArrowUpRight size={16} />
            </Link>
            <Link className="text-button" href={`/demo/${demo.id}/dashboard`}>
              Open isolated dashboard <ArrowRight size={16} />
            </Link>
            <details>
              <summary>Private scanner URL</summary>
              <p className="break-all small">{demo.link}</p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
