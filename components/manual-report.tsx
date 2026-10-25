"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, LocateFixed, MapPin } from "lucide-react";
import { api, post, scoped } from "@/lib/client";
import type { Bin, Point, PublicReport } from "@/lib/types";
import styles from "./manual-report.module.css";

export type ReportReceipt = {
  report: PublicReport;
  duplicate?: boolean;
  recovery?: string;
};
type Candidate = Bin & { distance?: number };
const metres = (n: number) =>
  n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(1)} km`;

export default function ManualReport({
  scope = "public",
  initialBin,
  initialNote = "",
  image,
  capturedAt,
  onSaved,
}: {
  scope?: string;
  initialBin?: Bin | null;
  initialNote?: string;
  image?: string;
  capturedAt?: string;
  onSaved: (receipt: ReportReceipt) => void;
}) {
  const [selected, setSelected] = useState<Candidate | null>(
    initialBin || null,
  );
  const [query, setQuery] = useState(initialBin?.name || "");
  const [results, setResults] = useState<Candidate[]>([]);
  const [near, setNear] = useState<Candidate[]>([]);
  const [locationMessage, setLocationMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [issue, setIssue] = useState("overflowing");
  const [note, setNote] = useState(initialNote.slice(0, 1000));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(!initialBin);
  const input = useRef<HTMLInputElement>(null);
  const edited = useRef(Boolean(initialBin));
  const locationVersion = useRef(0);
  const saveLock = useRef(false);
  const key = useRef<string | null>(null);
  const choose = (bin: Candidate) => {
    edited.current = true;
    setSelected(bin);
    setQuery(bin.name);
    setEditing(false);
    setResults([]);
    setError("");
    key.current = null;
  };
  async function locate() {
    const version = ++locationVersion.current;
    if (!navigator.geolocation) {
      setLocationMessage(
        "Location is unavailable. Search for a street or bin below.",
      );
      return;
    }
    setLocating(true);
    setLocationMessage("Finding your nearest bin…");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        if (version !== locationVersion.current) return;
        const point: Point = [p.coords.longitude, p.coords.latitude];
        try {
          const data = await api<{ bins: Candidate[] }>(
            scoped(
              `/api/bins/nearby?lng=${point[0]}&lat=${point[1]}&nearest=true`,
              scope,
            ),
          );
          if (version !== locationVersion.current) return;
          setNear(data.bins);
          const nearest = data.bins[0];
          setLocationMessage(
            nearest
              ? `Nearest to your GPS location: ${nearest.name} · ${metres(nearest.distance!)} away`
              : "No registered bins found. Search a street or add a missing bin.",
          );
          if (!edited.current && nearest) {
            setSelected(nearest);
            setQuery(nearest.name);
            setEditing(false);
          }
        } catch {
          if (version === locationVersion.current)
            setLocationMessage(
              "Nearby bins could not load. Try again or search a street.",
            );
        } finally {
          if (version === locationVersion.current) setLocating(false);
        }
      },
      (e) => {
        if (version !== locationVersion.current) return;
        setLocating(false);
        setLocationMessage(
          e.code === 1
            ? "Location access is off. Search a street or bin below."
            : "Could not find your location. Retry or search a street.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
  }
  useEffect(() => {
    if (!initialBin && scope === "public") void locate();
    return () => {
      locationVersion.current++;
    };
  }, [scope]);
  useEffect(() => {
    setResults([]);
    setSearchError("");
    if (!editing || query.trim().length < 2) {
      setSearching(false);
      return;
    }
    const abort = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      api<{ bins: Bin[] }>(
        scoped(
          `/api/bins?q=${encodeURIComponent(query.trim())}&limit=12`,
          scope,
        ),
        { signal: abort.signal },
      )
        .then((d) => {
          if (!abort.signal.aborted)
            setResults(d.bins.filter((b) => b.status === "Existing"));
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setSearchError(
              "Search could not load. Edit the street to retry, or use nearby bins.",
            );
        })
        .finally(() => {
          if (!abort.signal.aborted) setSearching(false);
        });
    }, 220);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [query, editing, scope]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      const receipt = await post<ReportReceipt>(scoped("/api/reports", scope), {
        binId: selected.id,
        location: [selected.lng, selected.lat],
        matchMethod: "selected",
        scanIds: [],
        source: "manual",
        issue,
        note,
        idempotencyKey: key.current,
        ...(image ? { image, capturedAt: capturedAt || null } : {}),
      });
      onSaved(receipt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  const options = query.trim().length >= 2 ? results : near;
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.location}>
        <MapPin size={17} aria-hidden="true" />
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            input.current?.focus();
          }}
        >
          {selected ? selected.name : "Choose a bin"}
          <span>
            {selected
              ? `${selected.sourceId || "Community bin"}${selected.side ? ` · ${selected.side} side` : ""}`
              : "Search by street or City bin ID"}
          </span>
        </button>
      </div>
      <label>
        Bin
        <input
          ref={input}
          disabled={saving}
          aria-label="Street or City bin ID"
          placeholder="Type a street or City bin ID"
          value={query}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            edited.current = true;
            setQuery(e.target.value);
            setSelected(null);
            setEditing(true);
            key.current = null;
          }}
        />
      </label>
      {scope === "public" && (
        <div className={styles.gps}>
          <span role="status">
            {locationMessage ||
              (selected?.distance !== undefined
                ? `Nearest registered bin · ${metres(selected.distance)} away`
                : "Check the selected bin before reporting.")}
          </span>
          <button
            type="button"
            disabled={locating || saving}
            onClick={() => {
              edited.current = false;
              void locate();
            }}
          >
            <LocateFixed size={15} />
            {locating ? "Finding location…" : "Use my location"}
          </button>
        </div>
      )}
      {editing && (
        <div
          className={styles.options}
          role="region"
          aria-label="Matching bins"
        >
          {searching ? (
            <p role="status">Searching bins…</p>
          ) : searchError ? (
            <p role="alert">{searchError}</p>
          ) : options.length ? (
            options.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={saving}
                onClick={() => choose(b)}
              >
                <span>
                  <strong>{b.name}</strong>
                  <small>
                    {b.sourceId || "Community bin"} ·{" "}
                    {b.side || b.address || "Toronto"}
                    {b.distance !== undefined ? ` · ${metres(b.distance)}` : ""}
                  </small>
                </span>
                {selected?.id === b.id ? (
                  <Check size={16} />
                ) : (
                  <ArrowRight size={16} />
                )}
              </button>
            ))
          ) : (
            <p>
              {query.trim().length >= 2
                ? "No bins found. Try another street or City ID."
                : "Type at least two characters, or use your location."}
            </p>
          )}
        </div>
      )}
      <label>
        Issue
        <select
          value={issue}
          disabled={saving}
          onChange={(e) => {
            setIssue(e.target.value);
            key.current = null;
          }}
        >
          <option value="overflowing">Overflowing bin</option>
          <option value="litter">Litter around a bin</option>
          <option value="damaged">Damaged bin</option>
          <option value="dumping">Illegal dumping</option>
        </select>
      </label>
      <label>
        Details <span className={styles.optional}>(optional)</span>
        <textarea
          maxLength={1000}
          value={note}
          disabled={saving}
          onChange={(e) => {
            setNote(e.target.value);
            key.current = null;
          }}
          placeholder="Add a useful landmark or detail."
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button
        className={styles.submit}
        type="submit"
        disabled={!selected || saving}
      >
        {saving ? "Saving report…" : "Report this bin"}
        <ArrowRight size={16} />
      </button>
      <Link className={styles.missing} href={scoped("/bins/new", scope)}>
        Can’t find it? Add a missing bin.
      </Link>
    </form>
  );
}
