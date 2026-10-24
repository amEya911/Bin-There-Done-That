import Scanner from "@/components/scanner";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ camera?: string }>;
}) {
  const [{ id }, { camera }] = await Promise.all([params, searchParams]);
  return (
    <Scanner scope={"demo:" + id} demoId={id} cameraOff={camera === "off"} />
  );
}
