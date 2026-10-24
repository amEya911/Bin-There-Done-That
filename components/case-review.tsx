"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Shell } from "./ui";
import { api, relative, scoped, shortId, stateLabels } from "@/lib/client";
import type { Case, PublicReport, Summary } from "@/lib/types";
import { isCaseOpen } from "@/lib/cases";
import styles from "./case-review.module.css";

type Detail = { case: Case; reports: PublicReport[] };
export default function CaseReview({
  scope,
  canManage,
  onManage,
}: {
  scope: string;
  canManage: boolean;
  onManage: () => void;
}) {
  const [cases, setCases] = useState<Case[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [filter, setFilter] = useState("all");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const data = await api<Summary>(
          scoped("/api/dashboard?window=all", scope),
        );
        if (!disposed) {
          setCases(data.cases);
          setError("");
          setLoaded(true);
        }
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setLoaded(true);
        }
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [scope, retry]);
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    if (!selected) return;
    const abort = new AbortController();
    api<Detail>(scoped(`/api/cases/${selected}`, scope), {
      signal: abort.signal,
    })
      .then(setDetail)
      .catch((e) => {
        if (!abort.signal.aborted) setDetailError(e.message);
      });
    return () => abort.abort();
  }, [selected, scope, retry]);
  const visible = cases.filter((c) => filter === "all" || isCaseOpen(c.state));
  return (
    <Shell>
      <header className={styles.heading}>
        <div>
          <h1>Case review</h1>
          <p>Follow reported issues and their latest status.</p>
        </div>
        {canManage && (
          <button className={styles.manage} onClick={onManage}>
            Management sign-in <ArrowRight size={16} />
          </button>
        )}
      </header>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </div>
      )}
      <div className={styles.toolbar}>
        <span>
          {loaded
            ? `${visible.length} ${visible.length === 1 ? "case" : "cases"}`
            : "Loading cases…"}
        </span>
        <select
          aria-label="Filter cases"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelected(null);
          }}
        >
          <option value="all">All cases</option>
          <option value="open">Open cases</option>
        </select>
      </div>
      {loaded && !visible.length && !error ? (
        <div className={styles.empty}>
          <h2>{filter === "open" ? "No open cases" : "No cases yet"}</h2>
          <p>Reported issues will appear here.</p>
          <Link href="/dashboard">
            Back to the map <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        visible.length > 0 && (
          <div
            className={`${styles.layout} ${selected ? styles.selected : ""}`}
          >
            <div className={styles.list} aria-label="Reported cases">
              {visible.map((c) => (
                <button
                  key={c.id}
                  aria-pressed={selected === c.id}
                  onClick={() => setSelected(c.id)}
                >
                  <strong>{c.binName || "Unmatched location"}</strong>
                  <span>{stateLabels[c.state]}</span>
                  <small>Updated {relative(c.updatedAt)}</small>
                </button>
              ))}
            </div>
            <section className={styles.detail} aria-live="polite">
              {!selected ? (
                <p className={styles.prompt}>
                  Select a case to see its reports.
                </p>
              ) : (
                <>
                  <button
                    className={styles.back}
                    onClick={() => setSelected(null)}
                  >
                    <ArrowLeft size={16} /> All cases
                  </button>
                  {detailError ? (
                    <div className={styles.error} role="alert">
                      {detailError}
                      <button onClick={() => setRetry((n) => n + 1)}>
                        Try again
                      </button>
                    </div>
                  ) : !detail ? (
                    <p>Loading case…</p>
                  ) : (
                    <>
                      <h2>{detail.case.binName || "Unmatched location"}</h2>
                      <p className={styles.reference}>
                        Case {shortId(detail.case.id)} ·{" "}
                        {stateLabels[detail.case.state]}
                      </p>
                      <dl className={styles.facts}>
                        <div>
                          <dt>Recorded condition</dt>
                          <dd>
                            {detail.case.condition === "unknown"
                              ? "Not confirmed"
                              : detail.case.condition === "clear"
                                ? "Clear"
                                : "Overflowing"}
                          </dd>
                        </div>
                        <div>
                          <dt>Last updated</dt>
                          <dd>
                            {new Date(detail.case.updatedAt).toLocaleString()}
                          </dd>
                        </div>
                      </dl>
                      <h3>
                        {detail.reports.length}{" "}
                        {detail.reports.length === 1 ? "report" : "reports"}
                      </h3>
                      <ol className={styles.reports}>
                        {detail.reports.map((r) => (
                          <li key={r.id}>
                            <strong>
                              {(
                                {
                                  overflowing: "Overflowing bin",
                                  litter: "Litter",
                                  damaged: "Damaged bin",
                                  dumping: "Illegal dumping",
                                } as Record<string, string>
                              )[r.issue] || r.issue}
                            </strong>
                            <span>
                              {r.source === "camera"
                                ? "Camera observation"
                                : "Community observation"}{" "}
                              · {new Date(r.createdAt).toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ol>
                      {detail.case.binId && (
                        <Link
                          className={styles.binLink}
                          href={scoped(`/bins/${detail.case.binId}`, scope)}
                        >
                          View bin history <ArrowRight size={16} />
                        </Link>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        )
      )}
    </Shell>
  );
}
