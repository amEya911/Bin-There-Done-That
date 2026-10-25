import type { Metadata, Viewport } from "next";
import Dashboard from "@/components/dashboard";
export const metadata: Metadata = { icons: { icon: "/dashboard-icon.svg" } };
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1a16" },
  ],
};
export default function Page() {
  return <Dashboard />;
}
