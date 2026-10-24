import { headers } from "next/headers";
import { redirect } from "next/navigation";
export default async function Home() {
  const h = await headers();
  redirect(
    /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(h.get("user-agent") || "")
      ? "/scan"
      : "/dashboard",
  );
}
