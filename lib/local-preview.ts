import type { Box, Detection, Guidance } from "./types";
import catalog from "@/training/recognition-v1.json";

type Found = { label: string; score: number; box: Box };
export type LocalClass = { name: string; canonicalSuggestion?: string | null };
const display = Object.fromEntries(catalog.objectDetection.classes.map(c => [c.name, c.displayName]));

export function localLabel(label: string, classes: LocalClass[] = []) {
  const canonical = classes.find(c => c.name === label)?.canonicalSuggestion;
  if (canonical && display[canonical]) return display[canonical];
  if (/unlabeled|other_plastic|scrap|unmapped/i.test(label)) return "Unidentified item";
  return label.replace(/^app_/, "").replace(/^(clear|other|disposable|aluminium|plastic|metal|paper|foam|glass)_/, "").replaceAll("_", " ");
}

// A location/identity preview never promotes a model's appearance label into
// verified material, a disposal rule, bin condition, or a public report.
export function localPreview(found: Found[], classes: LocalClass[] = []): { detection: Detection; guidance: Guidance[] } {
  const isBin = (d: Found) => classes.find(c => c.name === d.label)?.canonicalSuggestion === "waste_bin" || d.label === "app_waste_bin";
  const items = found.filter(d => !isBin(d)).slice(0, 8);
  const bin = found.find(isBin);
  const guidance: Guidance[] = items.map(d => ({ label: localLabel(d.label, classes), stream: "check", instruction: "Check the material and the applicable Toronto disposal rule.", source: "Experimental object-location preview", reviewed: "unverified", box: d.box }));
  return {
    detection: {
      scene: items.length ? "item" : bin ? "bin" : "uncertain",
      target: items.length ? localLabel(items[0].label, classes) : bin ? "Bin detected · condition not assessed" : "No confident match",
      certainty: "low", overflow: false, evidence: [], quality: [],
      components: items.map(d => ({ label: localLabel(d.label, classes), item: "unknown", material: "unknown", certainty: "low", box: d.box })),
      box: items[0]?.box ?? bin?.box ?? null,
      message: "Experimental recognition preview. Disposal and bin condition are not verified.",
    }, guidance,
  };
}
