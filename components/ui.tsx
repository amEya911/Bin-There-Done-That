"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";
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
} from "lucide-react";
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
      aria-label="Bin There Done That home"
    >
      <span className={styles.symbol} aria-hidden="true">
        <Trash2 size={27} strokeWidth={1.8} />
      </span>
      <span className={styles.wordmark}>
        <span>Bin There</span>{" "}
        <span>
          Done That<span className={styles.period}>.</span>
        </span>
      </span>
    </Link>
  );
}
export function Shell({
  children,
  wide = false,
  scanHref = "/scan",
}: {
  children: React.ReactNode;
  wide?: boolean;
  scanHref?: string;
}) {
  const path = usePathname();
  const items = [
    { href: "/dashboard", name: "City overview", icon: LayoutDashboard },
    { href: "/scan", name: "Scan & sort", icon: ScanLine },
    { href: "/bins/new", name: "Add a bin", icon: MapPin },
    { href: "/manage/cases", name: "Review cases", icon: Radio },
  ];
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Brand />
        <nav className={styles.navigation} aria-label="Main navigation">
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
