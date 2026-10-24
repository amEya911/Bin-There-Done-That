import type { ComponentDetection, Guidance } from "./types";
export const RULE_SOURCE =
  "https://www.toronto.ca/services-payments/recycling-organics-garbage/recycling-right-in-public-spaces/";
export const RECYCLING_SOURCE =
  "https://www.toronto.ca/services-payments/recycling-organics-garbage/houses/changes-to-recycling-program/?accordion=items-accepted-in-recycling";
export const WASTE_WIZARD_SOURCE =
  "https://www.toronto.ca/services-payments/recycling-organics-garbage/waste-wizard/";
export const REVIEWED = "2026-10-22";
export const ITEM_OPTIONS = [
  {
    id: "paper_cup",
    source: RECYCLING_SOURCE,
    label: "Paper beverage cup",
    stream: "recycling",
    instruction:
      "Empty liquids and food first. Put the paper cup body in recycling. Check the lid and straw separately.",
  },
  {
    id: "plastic_bottle",
    source: RECYCLING_SOURCE,
    label: "Plastic beverage bottle",
    stream: "recycling",
    instruction: "Empty the bottle, then use a recycling opening.",
  },
  {
    id: "metal_can",
    source: RECYCLING_SOURCE,
    label: "Metal beverage can",
    stream: "recycling",
    instruction: "Empty the can, then use a recycling opening.",
  },
  {
    id: "paper",
    source: RECYCLING_SOURCE,
    label: "Clean paper",
    stream: "recycling",
    instruction: "Keep it clean and dry. Put it in recycling.",
  },
  {
    id: "food",
    source: RULE_SOURCE,
    label: "Food scraps",
    stream: "organics",
    instruction:
      "Use a Green Bin if one is available. If there is no Green Bin, use garbage.",
  },
  {
    id: "dog_waste",
    source: RULE_SOURCE,
    label: "Bagged dog waste",
    stream: "organics",
    instruction:
      "Use a park Green Bin if available. Otherwise use garbage or take it home to your Green Bin.",
  },
  {
    id: "snack_bag",
    source: RULE_SOURCE,
    label: "Empty chip / snack bag",
    stream: "recycling",
    instruction:
      "Empty the bag, then use recycling under Toronto’s current public-space rules.",
  },
  {
    id: "unknown",
    source: WASTE_WIZARD_SOURCE,
    label: "Another item / unsure",
    stream: "check",
    instruction:
      "Check Toronto Waste Wizard. Material and local collection rules matter; do not guess.",
  },
] as const;
export function guidance(components: ComponentDetection[]): Guidance[] {
  return components.map((c) => {
    const rule = ITEM_OPTIONS.find((r) => r.id === c.item);
    const known = rule && c.certainty === "high" && rule.id !== "unknown";
    return {
      label: c.label,
      stream: known ? rule.stream : "check",
      instruction: known
        ? rule.instruction
        : "I cannot confirm this component’s material. Check the label or Toronto Waste Wizard before choosing a stream.",
      source: known ? rule.source : WASTE_WIZARD_SOURCE,
      reviewed: REVIEWED,
      box: c.box,
    };
  });
}
