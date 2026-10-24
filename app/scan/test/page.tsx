import type { Metadata } from "next";
import LocalVisionTest from "@/components/local-vision-test";

export const metadata: Metadata = {
  title: "Phone model test · Bin There Done That",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <LocalVisionTest />;
}
