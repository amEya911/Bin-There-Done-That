"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Download, ArrowUpRight, Lock } from "lucide-react";
import { Shell, PageHeading, ErrorNote } from "./ui";
import { post, scoped, shortId, stateLabels } from "@/lib/client";
export default function Receipt({ id }: { id: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [key, setKey] = useState("");
  useEffect(() => {
    const k = new URLSearchParams(location.hash.slice(1)).get("key") || "";
    setKey(k);
    post("/api/receipts/" + id, { recovery: k || undefined })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <Shell>
      <PageHeading
        eyebrow="A PRIVATE RECORD OF YOUR LITTLE GOOD"
        title="Seen. Saved. Connected."
        description="Keep this receipt link to follow your observation. Its recovery key is private."
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <div className="panel receipt-panel">
          <span className="saved-check">
            <Check size={30} />
          </span>
          <h2>Report #{shortId(id)}</h2>
          <div className="notice">
            <Lock size={16} />
            Only the original reporter, a recovery-link holder or an operator
            can view this receipt.
          </div>
          <dl>
            <dt>Recorded in</dt>
            <dd>
              Bin There Done That ·{" "}
              {data.report.scope === "public"
                ? "Community space"
                : "Isolated demo"}
            </dd>
            <dt>Observed issue</dt>
            <dd>{data.report.issue}</dd>
            <dt>Source</dt>
            <dd>{data.report.source}</dd>
            <dt>Received</dt>
            <dd>{new Date(data.report.createdAt).toLocaleString()}</dd>
            <dt>Capture time</dt>
            <dd>
              {data.report.capturedAt
                ? new Date(data.report.capturedAt).toLocaleString()
                : "Unknown / not recorded"}
            </dd>
            <dt>Case state</dt>
            <dd>{stateLabels[data.case?.state] || "Observed"}</dd>
            <dt>Report status</dt>
            <dd>{data.report.status}</dd>
            <dt>External delivery</dt>
            <dd>Not submitted to Toronto 311</dd>
          </dl>
          <div className="receipt-actions">
            <button className="button outlined" onClick={() => window.print()}>
              <Download size={16} />
              Print / save receipt
            </button>
            {data.report.status === "active" && (
              <button
                className="text-button danger"
                onClick={async () => {
                  try {
                    await post(
                      scoped(`/api/reports/${id}/withdraw`, data.report.scope),
                      { recovery: key || undefined },
                    );
                    setData({
                      ...data,
                      report: { ...data.report, status: "withdrawn" },
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Withdraw this observation
              </button>
            )}
          </div>
          <Link href="/dashboard" className="text-button">
            Return to the city <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
    </Shell>
  );
}
