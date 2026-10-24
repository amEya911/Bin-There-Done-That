import Link from "next/link";
import {
  ArrowRight,
  Camera,
  MapPin,
  Recycle,
  ArrowUpRight,
} from "lucide-react";
import { Shell, PageHeading } from "@/components/ui";
export default function About() {
  return (
    <Shell>
      <PageHeading
        eyebrow="SMALL ACTIONS. SHARED SPACES."
        title="A little more care for the city."
        description="Bin There Done That connects everyday sorting decisions with a clearer picture of the waste problems around us."
        action={
          <Link className="button primary" href="/scan">
            Open scanner <ArrowRight size={16} />
          </Link>
        }
      />
      <div className="about-grid">
        {[
          {
            Icon: Camera,
            n: "01",
            title: "Point at the problem.",
            text: "The rear camera opens on phones. Gemini examines selected frames for visible overflow, or identifies components of an item. The camera video stays on the device.",
          },
          {
            Icon: Recycle,
            n: "02",
            title: "Give every part a place.",
            text: "Visible item components are matched to a reviewed subset of Toronto public-space rules. Unknown materials stay uncertain. Screen overlays guide your attention without pretending to track 3D openings.",
          },
          {
            Icon: MapPin,
            n: "03",
            title: "Put a little good on the map.",
            text: "Two consistent live camera observations can save an overflow report when its location is resolved. Reports, distinct cases and affected bins are counted separately.",
          },
        ].map((i) => (
          <article className="panel" key={i.n}>
            <i.Icon size={28} />
            <span className="section-number">{i.n}</span>
            <h2>{i.title}</h2>
            <p>{i.text}</p>
          </article>
        ))}
      </div>
      <div className="about-text panel">
        <h2>Real places. Honest limits.</h2>
        <p>
          The map starts with the supplied City of Toronto litter receptacle
          inventory: 10,457 records, of which 9,822 are listed as existing.
          Inventory status may lag physical changes. An unreported bin is not
          necessarily clean, and a heatmap reflects observation coverage rather
          than a citywide cleanliness score.
        </p>
        <p>
          Authorized operators can add physically existing bins inside
          designated areas, review evidence, assign work and record follow-up
          photos. Work marked complete and condition rechecked are different
          records. No automatic submission is made to Toronto 311.
        </p>
        <p>
          Reports and original evidence stay private to the reporter and
          authorized operators. Public map summaries omit precise unmatched
          coordinates, device identifiers and evidence photos. Selected evidence
          is retained for seven days by default; expired media is removed when
          the server processes scans.
        </p>
        <h3>Sources & acknowledgements</h3>
        <a
          href="https://open.toronto.ca/dataset/street-furniture-litter-receptacle/"
          target="_blank"
          rel="noreferrer"
        >
          City of Toronto · Street furniture litter receptacle data{" "}
          <ArrowUpRight size={14} />
        </a>
        <a
          href="https://www.toronto.ca/services-payments/recycling-organics-garbage/recycling-right-in-public-spaces/"
          target="_blank"
          rel="noreferrer"
        >
          Toronto · Recycling right in public spaces (reviewed October 22, 2026){" "}
          <ArrowUpRight size={14} />
        </a>
        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
          OpenFreeMap · OpenMapTiles · OpenStreetMap contributors{" "}
          <ArrowUpRight size={14} />
        </a>
        <a
          href="https://commons.wikimedia.org/wiki/File:Overflowing_Hamburg_street_garbage_bin.jpg"
          target="_blank"
          rel="noreferrer"
        >
          Demo photo · Alexander Marks, Hamburg, 2005 · Public domain{" "}
          <ArrowUpRight size={14} />
        </a>
        <p className="small muted">
          The demo uses a historical photograph as a camera-recognition target,
          with an explicitly selected Toronto asset. It is isolated from the
          public observation feed.
        </p>
      </div>
    </Shell>
  );
}
