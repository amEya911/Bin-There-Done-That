import BinDetail from "@/components/bin-detail";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const [{ id }, { scope }] = await Promise.all([params, searchParams]);
  return <BinDetail id={id} scope={scope || "public"} />;
}
