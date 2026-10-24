"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ArrowRight, Check, MapPin } from "lucide-react";
import { Shell, ErrorNote } from "./ui";
import ManualReport, { type ReportReceipt } from "./manual-report";
import {
  api,
  post,
  scoped,
  relative,
  stateLabels,
  shortId,
} from "@/lib/client";
import { isCaseOpen } from "@/lib/cases";
import type { Bin, Case, PublicReport } from "@/lib/types";
import styles from "./bin-detail.module.css";
const BinMap = dynamic(() => import("./bin-map"), { ssr: false });
type Detail = {
  bin: Bin;
  reports: PublicReport[];
  cases: Case[];
  ownReportIds: string[];
};
const issueName: Record<string, string> = {
  overflowing: "Overflowing bin",
  litter: "Litter",
  damaged: "Damaged bin",
  dumping: "Illegal dumping",
};
export default function BinDetail({
  id,
  scope,
}: {
  id: string;
  scope: string;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"report" | "resolve" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [resolvingIds, setResolvingIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [withdraw, setWithdraw] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  const formRoot = useRef<HTMLElement>(null);
  const mutation = useRef(false);
  const version = useRef(0);
  async function refresh() {
    const request = ++version.current;
    const next = await api<Detail>(scoped(`/api/bins/${id}`, scope));
    if (request === version.current) {
      setData(next);
      setError("");
    }
  }
  useEffect(() => {
    setData(null);
    setAction(null);
    setReceipt(null);
    setMessage("");
    setError("");
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (!mutation.current) void refresh().catch(() => {});
    }, 5000);
    return () => {
      version.current++;
      clearInterval(timer);
    };
  }, [id, scope]);
  useEffect(() => {
    if (action) {
      formRoot.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
      formRoot.current?.querySelector<HTMLElement>("h2")?.focus();
    }
  }, [action]);
  const activeIds = new Set(data?.reports.map((r) => r.caseId));
  const openCases =
    data?.cases.filter((c) => activeIds.has(c.id) && isCaseOpen(c.state)) || [];
  async function resolve() {
    if (!confirmed || mutation.current) return;
    mutation.current = true;
    setSaving(true);
    setError("");
    try {
      await post(scoped(`/api/bins/${id}/resolve`, scope), {
        confirmed: true,
        caseIds: resolvingIds,
      });
      setAction(null);
      setConfirmed(false);
      setReceipt(null);
      setMessage(
        "Marked resolved. The active map highlight is cleared for these issues; the history is kept.",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  async function withdrawReport(reportId: string) {
    if (mutation.current) return;
    mutation.current = true;
    setSaving(true);
    setError("");
    try {
      await post(scoped(`/api/reports/${reportId}/withdraw`, scope), {});
      setWithdraw(null);
      setReceipt(null);
      setMessage(
        "Your report was withdrawn. Reports from other people remain.",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  return (
    <Shell>
      <Link
        href={
          scope === "public"
            ? "/dashboard"
            : `/demo/${scope.slice(5)}/dashboard`
        }
        className={styles.back}
      >
        <ArrowLeft size={16} />
        Back to the map
      </Link>
      {error && (
        <ErrorNote>
          {error}{" "}
          <button
            className="text-button"
            onClick={() => void refresh().catch((e) => setError(e.message))}
          >
            Retry
          </button>
        </ErrorNote>
      )}
      {!data ? (
        !error && <p role="status">Finding this bin…</p>
      ) : (
        <>
          <header className={styles.heading}>
            <h1>{data.bin.name}</h1>
            <p>
              {data.bin.source === "toronto"
                ? "City bin"
                : "Community-added bin"}
              {data.bin.sourceId ? ` · ${data.bin.sourceId}` : ""}
            </p>
          </header>
          <div className={styles.layout}>
            <div className={styles.map}>
              <BinMap selected={data.bin} reports={data.reports} />
            </div>
            <div className={styles.info}>
              <dl className={styles.facts}>
                <div>
                  <dt>Street / location</dt>
                  <dd>{data.bin.address || data.bin.name}</dd>
                </div>
                {data.bin.side && (
                  <div>
                    <dt>Side of street</dt>
                    <dd>{data.bin.side}</dd>
                  </div>
                )}
                {data.bin.ward && (
                  <div>
                    <dt>Ward</dt>
                    <dd>{data.bin.ward}</dd>
                  </div>
                )}
                <div>
                  <dt>Inventory status</dt>
                  <dd>
                    {data.bin.status === "Existing"
                      ? "In service"
                      : "Temporarily removed"}
                  </dd>
                </div>
                <div>
                  <dt>Current reports</dt>
                  <dd>
                    {openCases.length
                      ? `${openCases.length} open ${openCases.length === 1 ? "issue" : "issues"}`
                      : "No open issues"}
                  </dd>
                </div>
              </dl>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={saving || data.bin.status !== "Existing"}
                  onClick={() => {
                    setAction("report");
                    setReceipt(null);
                    setMessage("");
                  }}
                >
                  <MapPin size={16} />
                  Report an issue
                </button>
                {openCases.length > 0 && (
                  <button
                    className={styles.secondary}
                    disabled={saving}
                    onClick={() => {
                      setResolvingIds(openCases.map((c) => c.id));
                      setConfirmed(false);
                      setAction("resolve");
                      setMessage("");
                    }}
                  >
                    <Check size={16} />
                    Mark resolved
                  </button>
                )}
              </div>
              {message && (
                <p className={styles.message} role="status">
                  {message}
                </p>
              )}
              {receipt && (
                <Link
                  className={styles.link}
                  href={`${scoped(`/receipts/${receipt.report.id}`, scope)}${receipt.recovery ? `#key=${receipt.recovery}` : ""}`}
                >
                  View your private receipt <ArrowRight size={15} />
                </Link>
              )}
            </div>
          </div>
          {action && (
            <section
              className={styles.actionForm}
              ref={formRoot}
              aria-label={
                action === "report"
                  ? "Report an issue"
                  : "Resolve reported issues"
              }
            >
              <div className={styles.formHeading}>
                <h2 tabIndex={-1}>
                  {action === "report"
                    ? "Report an issue"
                    : "Is the issue resolved?"}
                </h2>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setAction(null)}
                >
                  Cancel
                </button>
              </div>
              {action === "report" ? (
                <ManualReport
                  initialBin={data.bin}
                  scope={scope}
                  onSaved={(next) => {
                    setReceipt(next);
                    setAction(null);
                    setMessage("Your report is saved.");
                    void refresh().catch((e) => setError(e.message));
                  }}
                />
              ) : (
                <>
                  <p>
                    Mark the{" "}
                    {resolvingIds.length === 1
                      ? "reported issue"
                      : `${resolvingIds.length} reported issues`}{" "}
                    you checked as resolved. This updates the community map and
                    keeps the history.
                  </p>
                  <ul>
                    {data.cases
                      .filter((c) => resolvingIds.includes(c.id))
                      .map((c) => (
                        <li key={c.id}>
                          {issueName[c.issue || "overflowing"] || c.issue} ·
                          Case {shortId(c.id)}
                        </li>
                      ))}
                  </ul>
                  <label className={styles.confirm}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={saving}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>
                      I checked this bin and these issues are resolved.
                    </span>
                  </label>
                  <button
                    className={styles.primary}
                    disabled={!confirmed || saving}
                    onClick={resolve}
                  >
                    {saving ? "Saving…" : "Confirm resolved"}
                    <Check size={16} />
                  </button>
                  <p className={styles.note}>Recorded as a community update.</p>
                </>
              )}
            </section>
          )}
          <section className={styles.history}>
            <h2>
              Report history <span>{data.reports.length}</span>
            </h2>
            {!data.reports.length ? (
              <p className={styles.muted}>No reports recorded for this bin.</p>
            ) : (
              <ol>
                {[...data.reports]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((r) => (
                    <li key={r.id}>
                      <div>
                        <strong>{issueName[r.issue] || r.issue}</strong>
                        <span>
                          {isCaseOpen(r.caseState)
                            ? "Open"
                            : stateLabels[r.caseState || "resolved"]}{" "}
                          · {relative(r.createdAt)} ·{" "}
                          {r.source === "camera" ? "Camera" : "Community"}
                        </span>
                      </div>
                      {data.ownReportIds.includes(r.id) &&
                        (withdraw === r.id ? (
                          <div className={styles.withdraw}>
                            <span>Withdraw your report?</span>
                            <button
                              disabled={saving}
                              onClick={() => void withdrawReport(r.id)}
                            >
                              Yes, withdraw
                            </button>
                            <button
                              disabled={saving}
                              onClick={() => setWithdraw(null)}
                            >
                              Keep report
                            </button>
                          </div>
                        ) : (
                          <button
                            className={styles.link}
                            disabled={saving}
                            onClick={() => setWithdraw(r.id)}
                          >
                            Withdraw my report
                          </button>
                        ))}
                    </li>
                  ))}
              </ol>
            )}
            <h2>Case history</h2>
            {!data.cases.length ? (
              <p className={styles.muted}>No cases yet.</p>
            ) : (
              <ol>
                {[...data.cases]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((c) => (
                    <li key={c.id}>
                      <div>
                        <strong>{stateLabels[c.state]}</strong>
                        <span>
                          Case {shortId(c.id)} · {relative(c.updatedAt)}
                        </span>
                      </div>
                    </li>
                  ))}
              </ol>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
