import type { Metadata, Viewport } from "next";
import CameraScanner from "@/components/camera-scanner";
export const metadata: Metadata = { icons: { icon: "/dashboard-icon.svg" } };
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1a16" },
  ],
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ camera?: string }>;
}) {
  const { camera } = await searchParams;
  return <CameraScanner cameraOff={camera === "off"} />;
}
