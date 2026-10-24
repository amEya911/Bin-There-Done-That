import Scanner from "@/components/scanner";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ camera?: string }>;
}) {
  const { camera } = await searchParams;
  return <Scanner cameraOff={camera === "off"} />;
}
