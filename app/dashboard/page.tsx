import Dashboard from "@/components/dashboard";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window } = await searchParams;
  return <Dashboard timeWindow={window} />;
}
