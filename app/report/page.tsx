import ReportPage from "@/components/report-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { draft } = await searchParams;
  return <ReportPage draftId={draft || ""} />;
}
