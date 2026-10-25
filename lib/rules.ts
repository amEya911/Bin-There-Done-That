import type { ComponentDetection, Guidance } from "./types";
export const RULE_SOURCE =
  "https://www.toronto.ca/services-payments/recycling-organics-garbage/recycling-right-in-public-spaces/";
export const RECYCLING_SOURCE =
  "https://www.toronto.ca/services-payments/recycling-organics-garbage/houses/changes-to-recycling-program/?accordion=items-accepted-in-recycling";
export const WASTE_WIZARD_SOURCE =
  "https://www.toronto.ca/services-payments/recycling-organics-garbage/waste-wizard/";
export const WASTE_WIZARD_DATA_SOURCE =
  "https://www.toronto.ca/data/swms/wastewizard/data.json";
export const ORGANICS_SOURCE =
  "https://www.toronto.ca/services-payments/recycling-organics-garbage/houses/what-goes-in-my-green-bin/";
// This explicitly requested project policy is separate from Toronto's lookup.
export const PROJECT_STRAW_SOURCE = "project:straw-sorting";
export const REVIEWED = "2026-10-24";
// The provider identifies visible parts; this catalog decides local guidance.
export const VISION_ITEM_IDS = [
  "paper_cup",
  "plastic_bottle",
  "metal_can",
  "paper",
  "tissue",
  "plastic_container",
  "food",
  "dog_waste",
  "snack_bag",
  "cup_lid",
  "straw",
  "cup_sleeve",
  "bottle_cap",
  "cardboard",
  "glass_bottle",
  "unknown",
] as const;
export const ITEM_OPTIONS = [
  {
    id: "paper_cup",
    source: RULE_SOURCE,
    label: "Paper beverage cup",
    stream: "recycling",
    instruction:
      "Empty liquids and food first. Separate the visible parts and put the paper cup body loose in recycling.",
  },
  {
    id: "cup_lid",
    source: WASTE_WIZARD_DATA_SOURCE,
    label: "Cup lid",
    stream: "recycling",
    instruction:
      "Remove this disposable lid from the cup and place it loose in recycling after emptying any residue.",
  },
  {
    id: "straw",
    source: PROJECT_STRAW_SOURCE,
    label: "Straw",
    stream: "garbage",
    instruction:
      "Put a plastic straw in litter. Put a paper straw in paper recycling.",
  },
  {
    id: "cup_sleeve",
    source: WASTE_WIZARD_DATA_SOURCE,
    label: "Paper / cardboard cup sleeve",
    stream: "recycling",
    instruction:
      "Remove the paper or cardboard sleeve and put it in recycling if it is clean and dry. A reusable fabric or silicone sleeve should be kept and reused.",
  },
  {
    id: "bottle_cap",
    source: RECYCLING_SOURCE,
    label: "Bottle cap",
    stream: "recycling",
    instruction:
      "Keep a plastic cap on its empty plastic bottle and recycle them together. Separate a metal cap from a glass bottle and recycle it separately.",
  },
  {
    id: "cardboard",
    source: RECYCLING_SOURCE,
    label: "Cardboard packaging",
    stream: "recycling",
    instruction:
      "Empty food and remove other contents. Flatten clean cardboard and put it in recycling; keep large pieces out of a small street-bin opening.",
  },
  {
    id: "glass_bottle",
    source: RECYCLING_SOURCE,
    label: "Glass bottle",
    stream: "recycling",
    instruction:
      "Empty the glass bottle and remove its lid. Use the recycling opening; return eligible deposit bottles through their deposit-return program.",
  },
  {
    id: "plastic_bottle",
    source: RECYCLING_SOURCE,
    label: "Plastic beverage bottle",
    stream: "recycling",
    instruction: "Empty the bottle, then use a recycling opening.",
  },
  {
    id: "plastic_container",
    source: RECYCLING_SOURCE,
    label: "Disposable plastic food container",
    stream: "recycling",
    instruction:
      "Empty food and liquids, then rinse off residue and put this disposable plastic container in recycling. Put food scraps in a Green Bin.",
  },
  {
    id: "metal_can",
    source: RECYCLING_SOURCE,
    label: "Metal beverage can",
    stream: "recycling",
    instruction: "Empty the can, then use a recycling opening.",
  },
  {
    id: "tissue",
    source: ORGANICS_SOURCE,
    label: "Tissue, napkin or paper towel",
    stream: "organics",
    instruction:
      "Put this paper tissue, napkin or paper towel in a Green Bin. If no Green Bin is available, use the garbage / litter opening. Keep it out of paper recycling.",
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
    instruction: "Reposition the item for a clearer view.",
  },
] as const;

export function guidance(components: ComponentDetection[]): Guidance[] {
  return components.map((c) => {
    const rule = ITEM_OPTIONS.find((r) => r.id === c.item);
    const material = c.material.trim().toLowerCase().replace(/[_-]+/g, " ");
    const unknownMaterial =
      !material || /unknown|unsure|unidentified|not confirmed/.test(material);
    const base = {
      label: c.label,
      reviewed: REVIEWED,
      box: c.box,
      material: unknownMaterial
        ? (
            {
              paper_cup: "paper",
              paper: "paper",
              cup_sleeve: "cardboard",
              cardboard: "cardboard",
            } as Record<string, string>
          )[c.item] || c.material
        : c.material,
    };
    const unidentified: Guidance = {
      ...base,
      stream: "check",
      instruction: "Reposition the item for a clearer view.",
      source: WASTE_WIZARD_SOURCE,
      estimated: false,
    };
    // Normalization marks every component low when the overall frame is unusable.
    if (c.certainty === "low") return unidentified;
    const estimated =
      c.materialBasis !== "observed" ||
      c.certainty !== "high" ||
      unknownMaterial;
    // Reusable bodies may intentionally have item=unknown. Preserve reuse before
    // looking up disposable rules, including for their visible reusable lids.
    const reusable =
      /reusable|travel mug|silicone|ceramic|porcelain/.test(
        `${material} ${c.label.toLowerCase()}`,
      ) ||
      (c.item === "straw" && /steel|metal|glass/.test(material)) ||
      (c.item === "cup_sleeve" && /textile|fabric|cloth/.test(material));
    if (reusable)
      return {
        ...base,
        stream: "check",
        action: "reuse",
        instruction:
          "Keep and reuse this part. It does not belong in a street waste bin while it is still usable.",
        source: WASTE_WIZARD_SOURCE,
        estimated,
      };

    if (/battery|lithium|medical sharp|needle|mercury/.test(material))
      return {
        ...base,
        stream: "check",
        instruction:
          "Keep this item out of street bins. Use a designated collection point for hazardous waste.",
        source: RECYCLING_SOURCE,
        estimated,
      };
    if (!rule || rule.id === "unknown") return unidentified;

    if (
      ["paper", "cardboard", "cup_sleeve", "tissue"].includes(c.item) &&
      /chemical|cleaning product|solvent|disinfectant|paint/.test(material)
    )
      return {
        ...base,
        stream: "garbage",
        instruction:
          "Put this chemically soiled paper in garbage / litter. Do not put it in paper recycling or the Green Bin.",
        source: ORGANICS_SOURCE,
        estimated,
      };

    // A greasy pizza box or food-soiled uncoated paper is not clean paper
    // recycling. A disposable drink cup stays under its separate cup rule.
    if (
      ["paper", "cardboard", "cup_sleeve"].includes(c.item) &&
      /food.soiled|food.stained|greas|oily|food residue/.test(material) &&
      !/plastic|wax|laminat/.test(material) &&
      (!/coated/.test(material) || /uncoated/.test(material))
    )
      return {
        ...base,
        stream: "organics",
        instruction:
          "Put this food-soiled paper or cardboard in a Green Bin. If none is available, use garbage / litter. Keep it out of paper recycling.",
        source: ORGANICS_SOURCE,
        estimated,
      };

    // Current Waste Wizard entries route compostable plastic and compostable
    // paper cups to garbage, despite compostable claims on the package.
    if (
      /compostable|biodegradable|bio plastic|\bpla\b/.test(material) &&
      (/plastic|\bpla\b/.test(material) ||
        [
          "paper_cup",
          "cup_lid",
          "straw",
          "plastic_bottle",
          "plastic_container",
          "bottle_cap",
          "snack_bag",
        ].includes(c.item)) &&
      !(
        c.item === "straw" &&
        /paper/.test(material) &&
        !/plastic|wax|laminat/.test(material)
      )
    )
      return {
        ...base,
        stream: "garbage",
        instruction:
          "Put this compostable or biodegradable single-use part in garbage. Toronto does not accept these products in its Green Bin.",
        source:
          c.item === "straw" ? PROJECT_STRAW_SOURCE : WASTE_WIZARD_DATA_SOURCE,
        estimated,
      };

    if (c.item === "straw") {
      // The user-selected straw policy overrides the city lookup only here:
      // paper -> recycling, plastic/other disposable straws -> litter.
      const paper = /paper|fibre|fiber/.test(material);
      if (paper)
        return {
          ...base,
          stream: "recycling",
          instruction: "Put this paper straw in paper recycling.",
          source: PROJECT_STRAW_SOURCE,
          estimated,
        };
      return {
        ...base,
        stream: "garbage",
        instruction: "Put this disposable straw in litter.",
        source: PROJECT_STRAW_SOURCE,
        estimated,
      };
    }

    // Keep genuine contradictions unresolved instead of inventing an identity.
    const incompatible =
      !unknownMaterial &&
      ((["paper_cup", "paper", "cup_sleeve", "cardboard"].includes(c.item) &&
        !/paper|cardboard|fibre|fiber|boxboard/.test(material)) ||
        (c.item === "glass_bottle" && !/glass/.test(material)) ||
        (["plastic_bottle", "plastic_container"].includes(c.item) &&
          !/plastic|\bpet\b|\bhdpe\b|\bpp\b/.test(material)) ||
        (c.item === "metal_can" &&
          !/metal|alumin|steel|\btin\b/.test(material)));
    if (incompatible) return unidentified;
    return {
      ...base,
      stream: rule.stream,
      instruction: rule.instruction,
      source: rule.source,
      estimated,
    };
  });
}
