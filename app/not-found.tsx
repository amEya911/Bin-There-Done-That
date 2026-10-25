import Link from "next/link";
import { Shell } from "@/components/ui";

export default function NotFound() {
  return (
    <Shell>
      <section className="empty-state">
        <h1>Page not found</h1>
        <p>This page is no longer available.</p>
        <Link className="button primary" href="/dashboard">
          Back to the map
        </Link>
      </section>
    </Shell>
  );
}
