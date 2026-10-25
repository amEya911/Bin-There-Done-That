"use client";
import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";
import {
  ArrowUpRight,
  Camera,
  MapPin,
  Info,
  ArrowRight,
  Radio,
  ChevronDown,
  Check,
  Clock,
} from "lucide-react";
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path
        d="M6 28V14Q6 6 14 6H28M72 6H86Q94 6 94 14V28M94 72V86Q94 94 86 94H72M28 94H14Q6 94 6 86V72"
        stroke="var(--logo-frame)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <g transform="translate(19 20) scale(0.62)">
        <path
          d="M40 22V18Q40 14 44 14H56Q60 14 60 18V22"
          stroke="var(--logo-bin)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <rect x="20" y="22" width="60" height="10" rx="4" fill="var(--logo-bin)" />
        <path
          d="M26 36H74L69.5 84Q69 90 63 90H37Q31 90 30.5 84Z"
          fill="var(--logo-bin)"
        />
        <path
          d="M39 62L47 70L61 54"
          stroke="var(--logo-mark)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
export function Brand({
  light = false,
  href = "/dashboard",
}: {
  light?: boolean;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={`brand ${styles.brand} ${light ? `light ${styles.light}` : ""}`}
      aria-label="Bin There, Done That home"
    >
      <span className={styles.symbol} aria-hidden="true">
        <Logo size={54} />
      </span>
      <span className={styles.wordmark}>
        <span>Bin There,</span>{" "}
        <span>
          Done That<span className={styles.period}>.</span>
        </span>
      </span>
    </Link>
  );
}
export const REPORT_WINDOWS = [
  { value: "24h", name: "Last 24 hours" },
  { value: "7d", name: "Last 7 days" },
  { value: "all", name: "All time" },
];
export function Shell({
  children,
  wide = false,
  scanHref = "/scan",
  timeWindow,
}: {
  children: React.ReactNode;
  wide?: boolean;
  scanHref?: string;
  timeWindow?: string;
}) {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const period = useRef<HTMLDetailsElement>(null);
  const close = () => {
    menu.current?.removeAttribute("open");
    period.current?.removeAttribute("open");
  };
  const overview =
    path.startsWith("/demo/") && path.endsWith("/dashboard")
      ? path
      : "/dashboard";
  const onOverview = path === "/dashboard" || path.startsWith("/demo/");
  const pages = [
    { href: "/bins/new", name: "Add a bin", icon: MapPin },
    { href: "/manage/cases", name: "Review cases", icon: Radio },
    { href: "/about", name: "About", icon: Info },
  ];
  const onMenuPage = pages.some((p) => p.href === path);
  const current = REPORT_WINDOWS.find((w) => w.value === timeWindow);
  const windows = (id: string) =>
    timeWindow && (
      <>
        <p className={styles.menuLabel} id={id}>
          Reports shown
        </p>
        <div role="group" aria-labelledby={id}>
          {REPORT_WINDOWS.map((w) => (
            <Link
              key={w.value}
              href={`${overview}?window=${w.value}`}
              aria-current={timeWindow === w.value ? "true" : undefined}
              onClick={close}
            >
              {timeWindow === w.value ? <Check size={16} /> : <Clock size={16} />}
              {w.name}
            </Link>
          ))}
        </div>
      </>
    );
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Brand />
        <nav className={styles.navigation} aria-label="Main navigation">
          <Link
            href="/dashboard"
            className={onOverview ? styles.current : ""}
            aria-current={onOverview ? "page" : undefined}
          >
            Overview
          </Link>
          {pages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className={`${styles.wideOnly} ${path === p.href ? styles.current : ""}`}
              aria-current={path === p.href ? "page" : undefined}
            >
              {p.name}
            </Link>
          ))}
          {current && (
            <details className={`${styles.more} ${styles.wideOnly}`} ref={period}>
              <summary aria-label={`Reports shown: ${current.name}`}>
                <Clock size={15} aria-hidden="true" />
                {current.name}
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className={styles.menu}>{windows("report-window-wide")}</div>
            </details>
          )}
          <details
            className={`${styles.more} ${styles.narrowOnly} ${onMenuPage ? styles.current : ""}`}
            ref={menu}
          >
            <summary>
              Menu <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className={styles.menu}>
              <p className={styles.menuLabel} id="menu-pages">
                Pages
              </p>
              <div role="group" aria-labelledby="menu-pages">
                {pages.map((p) => (
                  <Link
                    key={p.href}
                    href={p.href}
                    aria-current={path === p.href ? "page" : undefined}
                    onClick={close}
                  >
                    <p.icon size={16} />
                    {p.name === "About" ? "About the project" : p.name}
                  </Link>
                ))}
              </div>
              {windows("report-window-narrow")}
            </div>
          </details>
        </nav>
        <Link
          className={styles.scanLink}
          href={scanHref}
          aria-label="Open camera scanner"
        >
          <Camera size={18} />
          <span>Open camera</span>
        </Link>
      </header>
      <main className={`${styles.main} ${wide ? styles.wide : ""}`}>
        {children}
      </main>
    </div>
  );
}
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="notice error" role="alert">
      {children}
    </div>
  );
}
export function EmptyBin({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 80 : 150}
      height={small ? 90 : 150}
      viewBox="0 0 160 160"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M47 49L54 136H111L119 49"
        fill="#e5ede1"
        stroke="#20251C"
        strokeWidth="3"
      />
      <path
        d="M42 48H122M63 46V34H100V46M69 67L73 119M95 67L91 119"
        stroke="#20251C"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M118 18L122 31M131 34L142 29M39 82L25 87M37 94L30 103"
        stroke="#c74b25"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M67 87L78 98L99 75"
        stroke="#20251C"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="52" cy="142" r="5" fill="#20251C" />
      <circle cx="110" cy="142" r="5" fill="#20251C" />
    </svg>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="button primary" href={href}>
      {children}
      <ArrowRight size={17} />
    </Link>
  );
}
