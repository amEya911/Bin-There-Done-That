"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";
import {
  Camera,
  LayoutDashboard,
  MapPin,
  Info,
  ArrowRight,
  ScanLine,
  Radio,
  ChevronDown,
  Check,
  Clock,
} from "lucide-react";
export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link
      href={href}
      className={`brand ${styles.brand}`}
      aria-label="Bin There, Done That home"
    >
      <span className={styles.symbol} aria-hidden="true">
        <BrandLogo />
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
function BrandLogo({ size = 54 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
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
    <div className={`${styles.shell} ${dashboard ? styles.dashboard : ""}`}>
      <header className={styles.header}>
        <Brand />
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
            className={path === "/dashboard" ? styles.current : ""}
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
  return <BrandLogo size={small ? 80 : 150} />;
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
