"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Camera, Check, LoaderCircle } from "lucide-react";
import { Shell } from "./ui";
import { imageData, post, scoped } from "@/lib/client";
import type { Bin, Point } from "@/lib/types";
import styles from "./add-bin.module.css";

type Location = { point: Point; accuracy: number; locatedAt: string };

export default function AddBin({ scope }: { scope: string }) {
  const [photo, setPhoto] = useState("");
  const [location, setLocation] = useState<Location | null>(null);
  const [locating, setLocating] = useState(true);
  const [locationError, setLocationError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [saved, setSaved] = useState<Bin | null>(null);
  const key = useRef<string | null>(null);
  const mounted = useRef(true);

  function locate() {
    setLocating(true);
    setLocationError("");
    setLocation(null);
    key.current = null;
    if (!navigator.geolocation) {
      setLocating(false);
      setLocationError(
        "This browser cannot find your location. Use a phone with location access.",
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!mounted.current) return;
        setLocating(false);
        if (p.coords.accuracy > 25) {
          setLocationError(
            "Your location is not precise enough. Move outdoors and try again.",
          );
          return;
        }
        setLocation({
          point: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          locatedAt: new Date(p.timestamp).toISOString(),
        });
      },
      (e) => {
        if (!mounted.current) return;
        setLocating(false);
        setLocationError(
          e.code === 1
            ? "Allow location access in your browser to place this bin on the map."
            : "We couldn’t find your location. Move outdoors and try again.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  useEffect(() => {
    mounted.current = true;
    locate();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function selectPhoto(file?: File) {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      const image = await imageData(file);
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image))
        throw new Error("Choose a JPEG, PNG or WebP photo.");
      setPhoto(image);
      key.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!photo || !location || busy) return;
    if (Date.now() - Date.parse(location.locatedAt) > 110_000) {
      setError("Refreshing your location. Add the bin once it’s ready.");
      locate();
      return;
    }
    setBusy(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      const result = await post<{ bin: Bin }>(
        scoped("/api/bins/submit", scope),
        {
          image: photo,
          location: location.point,
          accuracy: location.accuracy,
          locatedAt: location.locatedAt,
          idempotencyKey: key.current,
        },
      );
      setSaved(result.bin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell scanHref={scoped("/scan", scope)}>
      <div className={styles.page}>
        {saved ? (
          <section className={styles.success} aria-live="polite">
            <Check size={30} strokeWidth={1.7} />
            <h1>Bin added</h1>
            <p>It’s now on the community map.</p>
            <Link
              className={styles.submit}
              href={scoped(`/bins/${saved.id}`, scope)}
            >
              View bin <ArrowRight size={17} />
            </Link>
          </section>
        ) : (
          <>
            <h1>Add a bin</h1>
            <p className={styles.intro}>
              Take a photo. We’ll place the bin at your location.
            </p>
            <form onSubmit={save} className={styles.form}>
              <label
                className={`${styles.photo} ${photo ? styles.hasPhoto : ""}`}
              >
                {photo ? (
                  <img src={photo} alt="Selected bin photo" />
                ) : (
                  <>
                    <Camera size={30} strokeWidth={1.5} />
                    <strong>
                      {reading ? "Opening photo…" : "Take a photo of the bin"}
                    </strong>
                    <span>or choose one from your photos</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  aria-label={
                    photo ? "Replace bin photo" : "Take or choose a bin photo"
                  }
                  disabled={busy || reading}
                  onChange={(e) => {
                    void selectPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {photo && <span className={styles.replace}>Replace photo</span>}
              </label>
              <div className={styles.location} aria-live="polite">
                {locating ? (
                  <span>
                    <LoaderCircle size={15} className={styles.spin} /> Finding
                    your location…
                  </span>
                ) : locationError ? (
                  <>
                    <p>{locationError}</p>
                    <button type="button" onClick={locate}>
                      Try location again
                    </button>
                  </>
                ) : (
                  <span>
                    <Check size={15} /> Location ready
                  </span>
                )}
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button
                className={styles.submit}
                disabled={!photo || !location || busy || locating || reading}
                type="submit"
              >
                {busy ? "Adding bin…" : "Add bin"}
                <ArrowRight size={17} />
              </button>
              <p className={styles.note}>
                New bins can be added inside designated areas. A bin already
                registered within 15 metres will block the addition.
              </p>
            </form>
          </>
        )}
      </div>
    </Shell>
  );
}
