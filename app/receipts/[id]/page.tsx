import Receipt from "@/components/receipt";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Receipt id={id} />;
}
