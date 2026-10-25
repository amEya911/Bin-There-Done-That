import Dashboard from "@/components/dashboard";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { id } = await params;
  const { window } = await searchParams;
  return <Dashboard scope={"demo:" + id} timeWindow={window} />;
}
