import type { Metadata, Viewport } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/space-grotesk";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "@/components/scanner-refresh.css";
import "./theme.css";
export const metadata: Metadata = {
  title: "Bin There Done That — Toronto bin map & waste sorting",
  description:
    "Point, sort and put overflowing bins on the radar. A community waste companion for Toronto.",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#141614" },
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
