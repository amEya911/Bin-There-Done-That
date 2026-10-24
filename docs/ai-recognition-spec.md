# AI recognition and annotation specification

Version 1.1.0, defined 24 October 2026. This defines a broad recognition catalog and how its training images should be labeled. Its scope is component-level waste guidance and visible bin overflow. A detector identifies objects; reviewed rules determine disposal; the server decides whether an observation can become a report.

The catalog now contains 40 planned object labels across eight families, plus three separate bin-condition labels. This is an extensible product catalog, not a claim that a trained model recognizes all 40 today. Every deployed model must declare its tested label coverage. Image preparation, training and integration follow these definitions; the active scanner is unchanged.

## Recognition tasks

There are two independent supervised tasks:

1. **Object detection:** boxes and classes for visible objects and components.
2. **Bin condition:** one class for one sufficiently clear bin crop.

Material, quality, source domain and review state are separate annotation attributes. Material metadata does not create a material-recognition model automatically. Runtime material claims need their own validated signal or user confirmation; object confidence alone is insufficient.

The canonical machine-readable definitions are in [recognition-v1.json](../training/recognition-v1.json). IDs are zero-based and fixed. Append new classes in a later version; never silently reorder an existing export.

If an external format uses different category IDs, preserve an explicit mapping back to these canonical IDs. Do not assume YOLO and COCO export conventions or a model's output order are interchangeable.

## Recognition catalog

Canonical IDs 0-7 are preserved from the initial definition. IDs 8-39 extend the catalog. Each physical part receives one label using the most specific supported definition; do not label the same part with both a broad and a narrow class. Distinct body, lid, cap and straw boxes can overlap.

### Drink containers and parts

| ID  | Label            | What to recognize                                                                                    | Exclusions and ambiguity                                                                                        |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0   | `cup_body`       | The visible body of a single-use beverage cup, independently of its material.                        | cup lids; straws; reusable mugs; drinking glasses; bowls                                                        |
| 1   | `cup_lid`        | A removable beverage cup lid, attached or detached, with a separately identifiable visible boundary. | bottle caps; jar lids; food-container lids; an inferred lid hidden behind an object                             |
| 2   | `straw`          | A visibly identifiable drinking straw; the class does not establish material or disposability.       | stirrers; pens; cables; chopsticks; unidentifiable thin lines                                                   |
| 3   | `bottle`         | An identifiable beverage bottle body; label a separately identifiable visible cap as bottle_cap.     | jars; cups; aerosols; household-product bottles pending a separate catalog extension; unidentifiable containers |
| 4   | `beverage_can`   | An identifiable beverage can, including crushed cans when enough visual evidence remains.            | aerosol cans; food tins; composite paper cans; unidentifiable crushed metal                                     |
| 8   | `bottle_cap`     | A visible cap or closure for a bottle, attached or detached.                                         | Cup lids; large food-container lids.                                                                            |
| 9   | `jar`            | An identifiable jar used for food or household products; material is a separate attribute.           | Narrow-neck beverage bottles; food tins.                                                                        |
| 34  | `drinking_glass` | An identifiable open drinking vessel that is not a disposable cup body or handled mug.               | Bottles; jars; mugs; disposable beverage cup bodies.                                                            |
| 35  | `mug`            | An identifiable handled drinking mug, with material and reuse status recorded separately.            | Disposable cup bodies; bowls; unidentifiable vessels.                                                           |

### Food containers and packaging

| ID  | Label            | What to recognize                                                                               | Exclusions and ambiguity                                                  |
| --- | ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 10  | `container_lid`  | A separately identifiable removable jar, tub or food-container lid.                             | Beverage cup lids; bottle caps; invisible closures.                       |
| 11  | `food_container` | A rigid food tub or takeaway box, with its body boxed separately from an identifiable lid.      | Open shallow trays; jars; tins; cup bodies.                               |
| 12  | `food_tray`      | A recognizable shallow open food tray; composition is not inferred from the class.              | Deep tubs; complete closed takeaway boxes; loose foil sheets.             |
| 13  | `food_tin`       | An identifiable canned-food container, including recognizable crushed tins.                     | Beverage cans; aerosols; composite paper cylinders.                       |
| 14  | `foil_sheet`     | An independently identifiable sheet or piece of household foil.                                 | Metallized plastic wrappers; formed food trays; uncertain shiny material. |
| 15  | `carton`         | An identifiable folded beverage or food carton; the whole object may be composite.              | Plain cardboard shipping boxes; cups; tins.                               |
| 20  | `flexible_film`  | A loose flexible wrapping sheet, with material recorded separately.                             | Formed carrier bags; identifiable printed food wrappers; household foil.  |
| 21  | `carrier_bag`    | A lightweight flexible shopping or carry bag, excluding identifiable paper bags.                | Paper bags; clearly used waste bags; loose film sheets.                   |
| 22  | `snack_packet`   | An identifiable bag-style snack packet; being empty or recyclable is not implied.               | Single-portion dispensing sachets; flat food wraps; plain carrier bags.   |
| 23  | `food_wrapper`   | An identifiable flat or folded food wrapper rather than a formed bag-style packet.              | Formed snack bags; dispensing sachets; loose unidentifiable film.         |
| 24  | `sachet`         | An identifiable small single-portion dispensing packet.                                         | Snack bags; large refill pouches; uncertain printed fragments.            |
| 25  | `cutlery`        | An identifiable fork, spoon or table knife, with material and reuse status recorded separately. | Straws; pens; unrelated sticks; specialist sharp tools.                   |

### Paper and cardboard

| ID  | Label             | What to recognize                                                                              | Exclusions and ambiguity                                                                       |
| --- | ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 5   | `paper_sheet`     | A visible loose sheet or clearly identifiable piece of paper.                                  | cardboard boxes or pieces; napkins and tissues; paper towels; mixed or unidentifiable wrappers |
| 16  | `cardboard_box`   | An identifiable cardboard box, including a flattened box whose box structure remains apparent. | Loose fragments no longer identifiable as boxes; beverage cartons.                             |
| 17  | `cardboard_piece` | A visible loose piece of cardboard no longer identifiable as an assembled or flattened box.    | Recognizable flattened boxes; paper sheets; paper tubes.                                       |
| 18  | `paper_bag`       | An identifiable paper bag, including handled paper shopping bags.                              | Flexible non-paper or material-ambiguous carrier bags; paper sheets.                           |
| 19  | `paper_tube`      | An identifiable hollow tube made from rolled paper or cardboard.                               | Plastic pipes; composite food cans; unrelated cylinders.                                       |
| 26  | `napkin_tissue`   | An independently identifiable disposable napkin or tissue.                                     | Office paper; identifiable paper towels; unidentifiable white scraps.                          |
| 27  | `paper_towel`     | An identifiable paper towel sheet or roll segment.                                             | Facial tissues; cloth towels; uncertain paper scraps.                                          |

### Food and bagged waste

| ID  | Label         | What to recognize                                                                           | Exclusions and ambiguity                                                    |
| --- | ------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 6   | `food_scraps` | Visible unwrapped food scraps, separately identifiable from packaging.                      | closed food packaging; dog waste; unidentifiable organic-looking material   |
| 28  | `waste_bag`   | An identifiable waste bag; contents and disposal stream are not inferred from its exterior. | Loose bags not identifiable as waste bags; any inferred dog-waste contents. |

### Personal-care items and small litter

| ID  | Label              | What to recognize                                                                  | Exclusions and ambiguity                                          |
| --- | ------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 29  | `disposable_glove` | An identifiable disposable glove; contamination and material remain separate.      | Reusable fabric gloves; contents guessed from nearby context.     |
| 30  | `disposable_mask`  | An identifiable disposable face mask, with contamination unknown unless supported. | Reusable cloth face coverings; unidentifiable fabric scraps.      |
| 31  | `cigarette_butt`   | An identifiable discarded cigarette or filter remnant.                             | Vapes; pens; unrelated short cylinders; unidentifiable fragments. |

### Textiles and footwear

| ID  | Label          | What to recognize                                                                               | Exclusions and ambiguity                                  |
| --- | -------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 32  | `textile_item` | An identifiable clothing or fabric article, without inferring its exact fibre or contamination. | Footwear; disposable tissues; disposable masks or gloves. |
| 33  | `footwear`     | An identifiable shoe, boot or sandal; each visible item is its own instance.                    | Loose fabric; unidentified rubber or plastic pieces.      |

### Items needing special guidance

| ID  | Label              | What to recognize                                                                                         | Exclusions and ambiguity                                                              |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 36  | `battery`          | An identifiable standalone battery or battery pack; chemistry, charge and damage status are not inferred. | Hidden batteries inside devices; power banks treated as devices; uncertain cylinders. |
| 37  | `small_electronic` | An identifiable small electronic product.                                                                 | Standalone batteries; hidden components; unidentifiable fragments.                    |
| 38  | `light_bulb`       | An identifiable light bulb or lamp; lamp technology and hazardous contents are not inferred.              | Glass jars; drinking glasses; hidden or inferred bulbs.                               |
| 39  | `aerosol_can`      | An identifiable aerosol container; contents, pressure and empty status are not inferred.                  | Beverage cans; pump bottles; food tins; uncertain cylinders.                          |

### Bin infrastructure

| ID  | Label       | What to recognize                                                                                                             | Exclusions and ambiguity                                                                                          |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 7   | `waste_bin` | A visible physical waste receptacle. Appearance does not establish City ownership, inventory identity, location or condition. | loose garbage bags; dumpsters outside the version-1 scope; boxes or buckets not identifiable as waste receptacles |

`waste_bin` describes appearance only. Ownership, registered asset identity, location and condition require separate checks. Similarly, a bag does not reveal its contents, a bottle does not establish its material, and a battery label does not establish its chemistry.

## Coverage and unfamiliar objects

A class is a category, not a single brand or product. For example, the bottle class can cover many beverage brands, sizes and shapes; it does not need one label per brand. Distinct materials and preparation conditions still affect disposal advice.

The catalog is not a ceiling. A small trained detector has a defined output vocabulary; families help organize that vocabulary but do not make it recognize arbitrary unseen objects. A deployed model manifest must list the exact canonical classes it supports and the validation used to activate them.

If a scene is unsupported or ambiguous, return an honest initial uncertainty message. Offer editable item lookup or optional broader model clarification. A suggested item name still needs a reviewed disposal rule and sufficient material/context evidence. Unknown objects must not be forced into the nearest known class, and a slower lookup must not be presented as a verified answer within two seconds.

The next catalog additions can include household-product bottles, shipping mailers, protective packaging, cables, toys, sanitary products, broken glass and bulky household items. Each promotion needs a clear label definition, training examples and difficult negatives, reviewed guidance, a validated export and an updated model coverage manifest.

### Objects needing special guidance

Batteries, small electronics, light bulbs and aerosols are planned recognition targets, but visual recognition is not a disposal decision. Do not infer chemistry, charge, pressure, damage or hidden contents. These labels require reviewed item-specific guidance and any necessary clarification; this specification adds no ordinary-bin disposal rule for them. Use the [Toronto Waste Wizard](https://www.toronto.ca/services-payments/recycling-organics-garbage/waste-wizard/) as a lookup entry point rather than inventing a stream.

## Bin condition classes

Use one crop containing one identified bin, its relevant opening and enough nearby context to attribute spillage. Multiple bins need separate crops and separate condition decisions.

| ID  | Label                   | Observable definition                                                                              | Automatic-report meaning                                                         |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0   | `normal`                | The opening/contents are sufficiently visible, with no overflow and no clear near-opening fullness | No overflow candidate; this is not a cleanliness guarantee                       |
| 1   | `full_without_overflow` | Contents visibly reach near the opening but stay inside it                                         | No overflow candidate; do not invent a fill percentage                           |
| 2   | `overflowing`           | Waste visibly protrudes from or spills out of an identifiable opening of this bin                  | Candidate only; server verification and physical-bin association remain required |

**Unverifiable is an abstention, not a forced class.** If the lid hides the contents, the opening is cropped, blur prevents inspection, or the source of ground litter is unclear, store `condition = null` and a reason. Keep the crop for quality/review evaluation and exclude it from the three-class condition training export until the label is resolved. A later quality gate must learn or otherwise detect such unusable views; low confidence alone is not a complete quality check.

A closed lid is not proof of normal, full or overflowing condition. Nearby ground litter is not proof that this bin overflowed. If protrusion is visible but its origin cannot be established, mark the condition unverifiable.

## Bounding box instructions

- Draw a tight axis-aligned rectangle around the visible extent of an identifiable object. Clip it at image boundaries. Do not extend through an occluder to invent the hidden shape.
- Give independently identifiable bodies, lids, caps and straws their own boxes. Attached and detached visible parts are both eligible. Label each physical part once; separate parts can have overlapping rectangles.
- Label each identifiable instance separately. Do not draw a second body box around the full cup assembly merely to include its parts.
- Do not infer a missing straw or lid. A lid hidden by a hand receives no lid box.
- Label a thin/small part only when it is independently identifiable. Record too-small cases for review and later input-resolution testing rather than guessing their class.
- For a confirmed unsupported object, draw no invented `unknown` box; it can be a documented negative. If it might be one of our supported targets but cannot be identified, mark the image for review and exclude it from supervised detection export until resolved. `unknown` is an application outcome, not an additional detection class.

Every accepted detection image needs complete labels for its independently identifiable supported instances. An unresolved possible target must not silently become background in a plain YOLO export. Exclude that image unless the chosen training pipeline explicitly supports ignore regions.

Annotation coordinates refer to the source image. The eventual app adapter must preserve the resize/padding transform and return normalized boxes in the exact crop visible in the camera. The current server parser imposes a minimum normalized width/height of 0.01; thin straw boxes may need an adapter/parser change during integration. Training boxes must retain their honest extents rather than being enlarged to work around that bound.

## Attributes and review metadata

| Attribute     | Values or requirement                                                                                                     | Labeling rule                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Material      | paper, cardboard, rigid plastic, flexible plastic, metal, glass, food, mixed, textile, rubber, ceramic, unknown           | Use a non-unknown value only with verified product information or a legible material marking, and record that reference |
| Visibility    | clear, partly occluded, truncated, too small to identify                                                                  | Describe the actual view; do not reconstruct hidden parts                                                               |
| Quality flags | blur, darkness, glare, opening obscured, target truncated, too small, unclear spillage origin, ambiguous multiple targets | More than one flag may apply                                                                                            |
| Domain        | physical scene, screen rephotograph, printed image                                                                        | Keep presentation examples identifiable and evaluate them separately                                                    |
| Provenance    | source/license, capture session, physical bin or item group, site group                                                   | Enables lawful dataset preparation and later splits that keep related captures together                                 |
| Review state  | pending, accepted, needs review, excluded                                                                                 | Only accepted object labels and accepted non-null condition labels enter the corresponding training exports             |

These attributes belong in metadata/sidecars. Plain YOLO text annotations contain class and box values only; exporting those files must not discard the associated material, quality and grouping records.

Two annotators should first label the same small starter batch independently and reconcile disagreements against this guide. Revise ambiguous definitions before expanding the dataset. Do not use an annotator's guess as material truth or resolve a condition label from a report/GPS value rather than visible evidence.

## From an object class to a disposal instruction

Detection class names are not disposal categories. Most newly added classes have no reviewed app rule yet. The future adapter must map a class only after its rule and evidence gates are ready; otherwise return check/unknown. The current rule mappings are:

| Detection          | Existing rule key             | Required gate                                                                                           |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `cup_body`         | `paper_cup` or `unknown`      | Reliably establish a paper-based disposable body before applying the paper-cup rule                     |
| `cup_lid`, `straw` | `unknown`                     | Check material; a dedicated reviewed lid/straw rule must exist before confident disposal advice         |
| `bottle`           | `plastic_bottle` or `unknown` | Reliably establish a disposable plastic beverage bottle; glass/reusable bottles do not inherit the rule |
| `beverage_can`     | `metal_can` or `unknown`      | Reliably identify a metal beverage can and apply the preparation instruction                            |
| `paper_sheet`      | `paper` or `unknown`          | Material and applicable preparation/contamination conditions must be supported                          |
| `food_scraps`      | `food`                        | Apply the reviewed public-space instruction, including Green Bin availability                           |
| `waste_bin`        | No item rule                  | Route to condition inspection, followed by server/asset checks if eligible                              |

`snack_packet` can map to the existing `snack_bag` key only for an empty identifiable packet under the applicable reviewed public-space rule. Other added labels remain check/unknown until their own rule is reviewed. A `waste_bag` must never automatically map to `dog_waste`; bag contents need explicit reliable confirmation.

For example, Toronto permits paper-based beverage cups in the recycling compartments of street litter bins and park Blue Bins, and asks that recycling be empty of food and liquids. That does not establish the destination for every visible lid or straw. The project uses the [City's public-space recycling guidance](https://www.toronto.ca/services-payments/recycling-organics-garbage/recycling-right-in-public-spaces/), checked 24 October 2026, with separate component decisions.

## Automatic scene selection

- A clearly presented foreground item receives sorting guidance even without GPS. Its visible parts can receive separate callouts.
- A stable bin view routes to condition inspection. Waste inside the bin is not automatically a held item the user is asking to sort.
- When both are visible, prioritize a clearly presented item. If the intended target is ambiguous, show uncertainty and suppress automatic reporting until the bin view is unambiguous.
- Empty/unrelated scenes produce no fabricated label, instruction or report. Multiple comparable targets require a clear target before automatic reporting.
- Keep scene selection automatic; this specification adds no mode selector or extra camera toolbar.

Arrows first attach instructions to object parts. Pointing an arrow into a physical recycling opening is outside version 1: it needs separate opening detection and verified compartment identity. A bin's GPS point does not identify the correct opening.

## Evidence needed before an overflow report

The condition classifier produces a candidate, not a saved incident. Reporting still requires visible evidence, usable quality, two distinct fresh consistent frames, server-side verification, session/scope checks, an approved in-service physical asset, a fresh unambiguous GPS match or explicit bin selection, duplicate protection and successful persistence.

Never infer an exact fill percentage, asset identity, physical presence or a successful save from a model score. A screen/print image can resemble a real bin; provenance tags do not solve that at runtime. Intentional projector observations belong to isolated demo scope and must not create public incidents.

## Labeling examples and difficult negatives

| Scenario                                      | Correct labels and outcome                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cup with visible lid and straw                | Three detection boxes; independent material decisions; no bin-condition label                  |
| Cup without a visible straw                   | Cup body and visible lid only; never invent a straw                                            |
| A transparent or reusable bottle              | `bottle`; do not automatically map it to disposable plastic                                    |
| A pen beside a cup                            | Label the cup; pen is a negative for `straw`                                                   |
| Contents near the opening, fully contained    | `waste_bin` plus `full_without_overflow`; no overflow candidate                                |
| Waste protruding from an identifiable opening | `waste_bin` plus `overflowing`; candidate still needs verification and asset checks            |
| Closed bin with hidden contents               | `waste_bin`, null condition and an opening-obscured reason                                     |
| Litter beside a clearly normal bin            | `waste_bin` plus `normal` if the opening is inspectable; do not infer overflow from the litter |
| Ground waste with an unclear source           | Null condition with spillage-origin-unclear reason; no automatic report                        |
| Two adjacent bins                             | Two detection boxes and two condition crops; no arbitrary asset association                    |
| Projected overflow photograph                 | Tag screen rephotograph; evaluate in isolated demo scope; no public incident                   |
| Empty scene or unsupported packaging          | Documented negative; no invented class or report                                               |

## Scope and next handoff

The catalog includes common waste and visible objects needing special guidance. It does not claim universal item recognition, chemical diagnosis, numerical fill estimation, 3D anchoring, physical-opening arrows, or automatic reports for generic litter/illegal dumping. New class names do not activate new disposal rules or remove existing manual reporting features.

The next step is the phone-runtime compatibility and speed prototype. Dataset preparation and fine-tuning follow against this fixed taxonomy. The two-second feedback target starts after the camera/model are ready and must track useful recognition separately from uncertainty; this definition work does not claim measured performance.
