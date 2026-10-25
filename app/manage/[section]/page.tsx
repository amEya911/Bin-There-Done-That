import Manage from "@/components/manage";
import { notFound } from "next/navigation";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const [{ section }, { scope }] = await Promise.all([params, searchParams]);
  if (!["bins", "cases"].includes(section)) notFound();
  return (
    <Manage section={section as "bins" | "cases"} scope={scope || "public"} />
  );
}
