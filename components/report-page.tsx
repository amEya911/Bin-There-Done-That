"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, MapPin } from "lucide-react";
import { Brand } from "./ui";
import ManualReport, { type ReportReceipt } from "./manual-report";
import {
  readReportDraft,
  removeReportDraft,
  type ReportDraft,
} from "@/lib/report-draft";
import styles from "./report-page.module.css";

export default function ReportPage({ draftId }: { draftId: string }) {
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  useEffect(() => {
    setReceipt(null);
    setDraft(readReportDraft(draftId));
    setLoaded(true);
  }, [draftId]);
  useEffect(() => {
    if (!draft || receipt) return;
    const expiry = setTimeout(
      () => {
        removeReportDraft(draft.id);
        setDraft(null);
      },
      Math.max(0, draft.expiresAt - Date.now()),
    );
    return () => clearTimeout(expiry);
  }, [draft, receipt]);
  const returnTo = draft?.returnTo || "/scan?camera=off";
  function discard() {
    removeReportDraft(draftId);
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <Link href={returnTo} onClick={discard}>
          <ArrowLeft size={16} /> Back to camera
        </Link>
      </header>
      <main className={styles.main}>
        {!loaded ? (
          <p role="status">Preparing your report…</p>
        ) : !draft ? (
          <section className={styles.empty}>
            <h1>Take a new photo</h1>
            <p>This report photo is no longer available in this tab.</p>
            <Link href={returnTo}>
              Open camera <ArrowUpRight size={17} />
            </Link>
          </section>
        ) : receipt ? (
          <section className={styles.saved} aria-labelledby="saved-title">
            <span className={styles.savedIcon}>
              <Check aria-hidden="true" />
            </span>
            <h1 id="saved-title">
              {receipt.duplicate ? "Report already saved" : "Report saved"}
            </h1>
            <p>{receipt.report.binName || "Your selected bin"}</p>
            <p>
              The overflowing-bin report is now visible on the community map.
            </p>
            <div className={styles.links}>
              <Link
                href={`/receipts/${encodeURIComponent(receipt.report.id)}${receipt.recovery ? `#key=${encodeURIComponent(receipt.recovery)}` : ""}`}
              >
                View receipt <ArrowUpRight size={16} />
              </Link>
              {receipt.report.binId && (
                <Link
                  href={`/bins/${encodeURIComponent(receipt.report.binId)}`}
                >
                  View bin details <ArrowUpRight size={16} />
                </Link>
              )}
              <Link href="/dashboard">
                View map <MapPin size={16} />
              </Link>
            </div>
          </section>
        ) : (
          <>
            <div className={styles.heading}>
              <span>Overflowing bin detected</span>
              <h1>Confirm your report.</h1>
              <p>
                Your photo and issue are filled in. Check the nearest bin, then
                submit.
              </p>
            </div>
            <div className={styles.content}>
              <figure className={styles.photo}>
                <img
                  src={draft.image}
                  alt="Overflowing bin photo attached to this report"
                />
                <figcaption>
                  Captured{" "}
                  {new Date(draft.capturedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </figcaption>
              </figure>
              <section
                className={styles.form}
                aria-label="Confirm report details"
              >
                <ManualReport
                  scope={draft.scope}
                  initialBin={draft.initialBin}
                  initialNote={draft.note}
                  image={draft.image}
                  capturedAt={draft.capturedAt}
                  onSaved={(saved) => {
                    removeReportDraft(draftId);
                    setReceipt(saved);
                  }}
                />
                <Link
                  href={returnTo}
                  onClick={discard}
                  className={styles.discard}
                >
                  Discard and retake photo
                </Link>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
