"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";
import theme from "./brand-theme.module.css";
import {
  ArrowUpRight,
  Camera,
  LayoutDashboard,
  MapPin,
  Info,
  ArrowRight,
  Trash2,
  ScanLine,
  Radio,
  ChevronDown,
  Check,
  Clock,
} from "lucide-react";
export function Brand({
  light = false,
  href = "/dashboard",
  variant = "classic",
}: {
  light?: boolean;
  href?: string;
  variant?: "classic" | "forest";
}) {
  const forest = variant === "forest";
  return (
    <Link
      href={href}
      className={`brand ${styles.brand} ${forest ? styles.forestBrand : ""} ${light ? `light ${styles.light}` : ""}`}
      aria-label={
        forest ? "Bin There, Done That home" : "Bin There Done That home"
      }
    >
      <span className={styles.symbol} aria-hidden="true">
        {forest ? <ForestLogo /> : <Trash2 size={27} strokeWidth={1.8} />}
      </span>
      <span className={styles.wordmark}>
        <span>Bin There{forest ? "," : ""}</span>{" "}
        <span>
          Done That<span className={styles.period}>.</span>
        </span>
      </span>
    </Link>
  );
}
function ForestLogo() {
  return (
    <svg width="54" height="54" viewBox="0 0 100 100" fill="none">
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
        <rect
          x="20"
          y="22"
          width="60"
          height="10"
          rx="4"
          fill="var(--logo-bin)"
        />
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
export function Shell({
  children,
  wide = false,
  scanHref = "/scan",
  dashboard = false,
  affectedBins,
  reportWindow,
  onReportWindowChange,
}: {
  children: React.ReactNode;
  wide?: boolean;
  scanHref?: string;
  dashboard?: boolean;
  affectedBins?: number;
  reportWindow?: string;
  onReportWindowChange?: (value: string) => void;
}) {
  const path = usePathname();
  const items = [
    { href: "/dashboard", name: "City overview", icon: LayoutDashboard },
    { href: "/scan", name: "Scan & sort", icon: ScanLine },
    { href: "/bins/new", name: "Add a bin", icon: MapPin },
    { href: "/manage/cases", name: "Review cases", icon: Radio },
  ];
  return (
    <div
      className={`${styles.shell} ${dashboard ? `${styles.dashboard} ${theme.theme}` : ""}`}
    >
      <header className={styles.header}>
        <Brand variant={dashboard ? "forest" : "classic"} />
        <nav className={styles.navigation} aria-label="Main navigation">
          {dashboard && (
            <span
              className={styles.affectedBins}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <strong>
                {affectedBins === undefined
                  ? "—"
                  : affectedBins.toLocaleString()}
              </strong>
              <span>Affected bins</span>
            </span>
          )}
          <Link
            href="/dashboard"
            className={
              path === "/dashboard" || path.startsWith("/demo/")
                ? styles.current
                : ""
            }
            aria-current={path === "/dashboard" ? "page" : undefined}
          >
            Overview
          </Link>
          <details className={styles.more}>
            <summary>
              More <ChevronDown size={14} />
            </summary>
            <div className={styles.menu}>
              {dashboard && reportWindow && onReportWindowChange && (
                <div
                  className={styles.reportWindows}
                  role="group"
                  aria-label="Report time window"
                >
                  <p className={styles.menuLabel}>Reports shown</p>
                  {[
                    { value: "24h", label: "Last 24 hours" },
                    { value: "7d", label: "Last 7 days" },
                    { value: "all", label: "All time" },
                  ].map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={reportWindow === option.value}
                      onClick={(event) => {
                        onReportWindowChange(option.value);
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      {reportWindow === option.value ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <Clock size={16} aria-hidden="true" />
                      )}
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              {items
                .filter((i) => !["/dashboard", "/scan"].includes(i.href))
                .map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    aria-current={path === i.href ? "page" : undefined}
                  >
                    <i.icon size={16} />
                    {i.name}
                  </Link>
                ))}
              <Link href="/about">
                <Info size={16} />
                About the project
              </Link>
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
        fill="#D7E7BD"
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
        stroke="#FD643B"
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
