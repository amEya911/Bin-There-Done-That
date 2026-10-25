"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronDown,
  RefreshCw,
  X,
  Plus,
  Layers,
} from "lucide-react";
import { Shell, ErrorNote } from "./ui";
import { api, scoped, relative, shortId } from "@/lib/client";
import type { Bin, Summary, Point } from "@/lib/types";
import { isCaseOpen } from "@/lib/cases";
import styles from "./dashboard.module.css";
const BinMap = dynamic(() => import("./bin-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Opening Toronto…</div>,
});
type Data = Summary & {
  inventory: { total: number; active: number; removed: number; manual: number };
  manualBins: Bin[];
  updatedAt: string;
};
export default function Dashboard({
  scope = "public",
}: {
  scope?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [window, setWindow] = useState("24h");
  const [layer, setLayer] = useState<"bins" | "density" | "reports">("bins");
  const [selected, setSelected] = useState<Bin | null>(null);
  const [pin, setPin] = useState<Point | null>(null);
  const [tab, setTab] = useState("all");
  const [lastUpdated, setLastUpdated] = useState("");
  const refreshVersion = useRef(0);
  const selectionVersion = useRef(0);
  const mapRoot = useRef<HTMLDivElement>(null);
  function revealMap() {
    if (globalThis.matchMedia("(max-width: 760px)").matches)
      mapRoot.current?.scrollIntoView({
        behavior: globalThis.matchMedia("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
        block: "start",
      });
  }
  async function refresh() {
    const version = ++refreshVersion.current;
    try {
      const d = await api<Data>(
        scoped(`/api/dashboard?window=${window}`, scope),
      );
      if (version !== refreshVersion.current) return;
      setData(d);
      setLastUpdated(
        new Date().toLocaleTimeString("en-CA", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setError("");
    } catch (e) {
      if (version === refreshVersion.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3500);
    const online = () => refresh();
    globalThis.addEventListener("online", online);
    return () => {
      refreshVersion.current++;
      clearInterval(t);
      globalThis.removeEventListener("online", online);
    };
  }, [scope, window]);
  async function choose(id: string) {
    const version = ++selectionVersion.current;
    try {
      const d = await api<{ bin: Bin }>(scoped(`/api/bins/${id}`, scope));
      if (version !== selectionVersion.current) return;
      setSelected(d.bin);
      setPin(null);
      revealMap();
    } catch (e) {
      if (version === selectionVersion.current) setError((e as Error).message);
    }
  }
  const scanner = "/scan";
  const filtered =
    data?.reports.filter(
      (r) =>
        tab === "all" ||
        (tab === "unmatched" ? !r.binId : r.source === "camera"),
    ) || [];
  const hotspots = Object.entries(data?.binCounts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id, count]) => ({
      id,
      count,
      name:
        data?.reports.find((r) => r.binId === id)?.binName ||
        data?.cases.find((c) => c.binId === id)?.binName ||
        "Reported bin",
      cases: data?.cases.filter((c) => c.binId === id).length || 0,
    }));
  return (
    <Shell
      wide
      scanHref={scanner}
      dashboard
      affectedBins={data?.affectedBins}
      reportWindow={window}
      onReportWindowChange={setWindow}
    >
      <section className={styles.intro} aria-label="Toronto overview">
        <div className={styles.title}>
          <h1>
            Toronto<span>.</span>
          </h1>
          <p>Your city, a little clearer.</p>
        </div>
        <dl className={styles.summary} aria-label="City overview counts">
          <Metric label="Bin locations" value={data?.inventory.active} />
          <Metric label="Open reports" value={data?.totalReports} accent />
          <Metric label="Open cases" value={data?.activeCases} />
        </dl>
      </section>
      {error && (
        <ErrorNote>
          {error} <button onClick={refresh}>Retry</button>
        </ErrorNote>
      )}
      <section
        className={styles.workspace}
        aria-label="Toronto bins and reports"
      >
        <div className={styles.toolbar}>
          <div className={styles.filters}>
            <label className={styles.select}>
              <Layers size={15} aria-hidden="true" />
              <span className="sr-only">Map layer</span>
              <select
                aria-label="Map layer"
                value={layer}
                onChange={(e) => setLayer(e.target.value as typeof layer)}
              >
                <option value="bins">Bin locations</option>
                <option value="density">Bin density</option>
                <option value="reports">Report heatmap</option>
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
          </div>
        </div>
        <div className={styles.map} ref={mapRoot}>
          <BinMap
            layer={layer}
            reports={data?.reports || []}
            mapPoints={data?.mapPoints}
            manualBins={data?.manualBins || []}
            selected={selected}
            pin={pin}
            onSelect={choose}
          />
          {selected && (
            <div className={styles.inspector}>
              <button
                className={styles.close}
                aria-label="Close bin detail"
                onClick={() => {
                  selectionVersion.current++;
                  setSelected(null);
                }}
              >
                <X size={16} />
              </button>
              <span className={styles.provenance}>
                {selected.source === "toronto"
                  ? "City bin"
                  : "Community-added bin"}
              </span>
              <h2>{selected.name}</h2>
              <p>
                {selected.sourceId || "Registered physical bin"}
                {selected.side ? ` · ${selected.side} side` : ""}
              </p>
              <div>
                <span>
                  <strong>{data?.binCounts[selected.id] || 0}</strong> open
                  reports in this window
                </span>
                <Link href={scoped(`/bins/${selected.id}`, scope)}>
                  Details <ArrowUpRight size={15} />
                </Link>
              </div>
              {selected.status !== "Existing" && (
                <small>Temporarily removed from the source inventory.</small>
              )}
            </div>
          )}
        </div>
        <aside className={styles.feed} aria-label="Community reports">
          <div className={styles.feedHeading}>
            <h2>
              Open reports <span>{data?.totalReports ?? "—"}</span>
            </h2>
            <label>
              <span className="sr-only">Filter reports</span>
              <select
                aria-label="Filter reports"
                value={tab}
                onChange={(e) => setTab(e.target.value)}
              >
                <option value="all">All reports</option>
                <option value="camera">Camera</option>
                <option value="unmatched">Unmatched</option>
              </select>
            </label>
          </div>
          <div className={styles.feedBody}>
            {hotspots.length > 0 && (
              <section
                className={styles.hotspots}
                aria-label="Most reported locations"
              >
                <h3>Most reported</h3>
                {hotspots.map((h) => (
                  <button key={h.id} onClick={() => choose(h.id)}>
                    <span>
                      <strong>{h.name}</strong>
                      <small>
                        {h.cases} {h.cases === 1 ? "case" : "cases"}
                      </small>
                    </span>
                    <span className={styles.reportCount}>
                      {h.count}{" "}
                      <span>{h.count === 1 ? "report" : "reports"}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}
            {!data ? (
              <div className={styles.empty} role="status">
                <span className="loading-ring" />
                <h3>Loading reports…</h3>
              </div>
            ) : filtered.length === 0 ? (
              <div className={styles.empty}>
                <Check size={24} strokeWidth={1.6} />
                <h3>
                  {tab === "all" ? "No open reports" : "No matching reports"}
                </h3>
                <p>
                  {tab === "all"
                    ? "Open reports in this time window will appear here."
                    : "Try another filter or time window."}
                </p>
                <Link href={scanner}>
                  Open the camera <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <section className={styles.reports} aria-label="Recent reports">
                <h3>Recent open reports</h3>
                {filtered.slice(0, 25).map((r) => (
                  <button
                    className={styles.report}
                    key={r.id}
                    onClick={() => {
                      if (r.binId) choose(r.binId);
                      else {
                        selectionVersion.current++;
                        setSelected(null);
                        setPin(r.location);
                        revealMap();
                      }
                    }}
                  >
                    {isCaseOpen(r.caseState) ? (
                      <span className={styles.issueDot} />
                    ) : (
                      <Check size={12} aria-label="Resolved" />
                    )}
                    <span>
                      <strong>
                        {r.issue === "overflowing"
                          ? "Overflowing bin"
                          : r.issue === "damaged"
                            ? "Damaged bin"
                            : r.issue === "dumping"
                              ? "Illegal dumping"
                              : "Litter reported"}
                      </strong>
                      <span>
                        {r.binName ||
                          (r.binId ? shortId(r.binId) : "Unmatched location")}
                      </span>
                      <small>
                        {!isCaseOpen(r.caseState) ? "Resolved · " : ""}
                        {relative(r.createdAt)} ·{" "}
                        {r.source === "camera" ? "Camera" : "Community"}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </section>
            )}
          </div>
          <div className={styles.feedFooter}>
            <span>{lastUpdated ? `Updated ${lastUpdated}` : "Loading…"}</span>
            <button aria-label="Refresh reports" onClick={refresh}>
              <RefreshCw size={14} />
            </button>
          </div>
        </aside>
        <div className={styles.legend} aria-label="Map legend">
          <span>
            <i className={styles.binDot} />
            City bins
          </span>
          <span>
            <i className={styles.issueDot} />
            Reported issues
          </span>
          <span>
            <i className={styles.communityDot} />
            Community bins
          </span>
          <small>
            {layer === "density"
              ? "Bin density measures inventory, not cleanliness."
              : layer === "reports"
                ? "Community observations; coverage varies."
                : "Select a bin to see its reports."}
          </small>
        </div>
      </section>
      <footer className={styles.footer}>
        <Link href={scoped("/bins/new", scope)}>
          <Plus size={14} />
          Add a missing bin
        </Link>
      </footer>
    </Shell>
  );
}
function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value?: number;
  accent?: boolean;
}) {
  return (
    <div className={accent ? styles.accentMetric : ""}>
      <dt>{label}</dt>
      <dd>{value === undefined ? "—" : value.toLocaleString()}</dd>
    </div>
  );
}
