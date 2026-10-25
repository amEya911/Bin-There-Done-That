import CameraScanner from "@/components/camera-scanner";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ camera?: string }>;
}) {
  const { camera } = await searchParams;
  return <CameraScanner cameraOff={camera === "off"} />;
}
