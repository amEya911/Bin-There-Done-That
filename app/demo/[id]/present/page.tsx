import Presentation from "@/components/presentation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Presentation id={id} />;
}
