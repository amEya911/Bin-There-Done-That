import AddBin from "@/components/add-bin";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  return <AddBin scope={scope || "public"} />;
}
