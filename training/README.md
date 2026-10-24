# Waste dataset and recognition definitions

The versioned catalog defines forty object/part classes and three separate bin-condition classes. The website's main scanner still uses its Gemini adapter; `/scan/test` compares pretrained on-device models. Dataset preparation does not activate new runtime recognition or reporting.

The current collection target is **3,500 unique source photos**, within the requested3,000–4,000 range. Images, annotations, source archives, local login credentials and review events live under ignored `.data/`, never in the public app or Git. The code and label definitions in this directory reproduce the preparation workflow.

Read the [recognition and annotation specification](../docs/ai-recognition-spec.md) before labeling images.

| File                       | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `recognition-v1.json`      | Versioned machine-readable class definitions, attributes, routing and reporting constraints |
| `object-labels.txt`        | Forty planned detection classes, in fixed zero-based ID order                               |
| `bin-condition-labels.txt` | Three crop-classification labels, in fixed zero-based ID order                              |

Create two tasks when preparing a dataset: bounding-box detection of items/parts/bins, and classification of one bin crop. The two label lists are separate namespaces. Do not combine condition labels with the 40 object labels. Unverifiable conditions are review records with a null label, not a fourth condition class.

Keep material, quality, provenance and group metadata in sidecars or the dataset platform; plain YOLO box-label files cannot carry those attributes. Class-list files do not contain the actual image annotations.

No images or credentials belong in this directory. Runtime evidence remains in private Supabase Storage. Training data must be deliberately prepared, with source/license and grouping metadata; live report images are not automatically exported for training.

The planned catalog is not a recognition limit or a deployed-model claim. Families organize common objects, packaging, household items and objects needing special guidance. Unknown inputs use uncertainty and an optional lookup/clarification path. Every future model export must declare its actual tested class coverage. Original IDs 0-7 remain stable; version 1.1.0 adds IDs 8-39.

## Sources and annotation status

- **TACO:** litter in varied physical scenes, with source object annotations. The published v1.0 release declares CC BY4.0. Source boxes and mappings to our taxonomy remain proposals. Preserve original license notes and review individual provenance. Ambiguous source categories become `REVIEW_UNMAPPED`; they never silently become background.
- **TrashNet:** individual waste items photographed on a plain background. The creator's dataset repository declares MIT. Its six image categories are not our forty object labels and do not provide object boxes. No full-image boxes or verified-material labels are manufactured from those categories.
- **Open Images:** individually attributed candidate bins, fire-hydrant negatives, mugs, straws, light bulbs, paper towels, textiles and phones. Keep per-image license and original landing-page metadata. Broad waste-container labels still need review for unsupported dumpsters, multiple bins and hidden openings.

Sources: [TACO release](https://zenodo.org/records/3587843), [TACO toolkit](https://github.com/pedropro/TACO), [TrashNet creator](https://huggingface.co/datasets/garythung/trashnet), [Open Images](https://storage.googleapis.com/openimages/web/download_v7.html).

All imported images start **pending**. Public source labels do not establish complete component annotations, material, disposal rules, bin condition, or training readiness. Count unique pixel hashes separately from file IDs. Resized copies and augmentations are not counted as new source photos. The collection is not geographically specific to Toronto.

## Prepare locally

Use Python3.12 and the isolated tools environment described in [the inference guide](../docs/local-vision-test.md). The dataset tool never loads `.env.local` or connects to the app database.

```sh
.data/vision-tools/bin/python scripts/waste-dataset.py init
.data/vision-tools/bin/python scripts/waste-dataset.py seed-bins
.data/vision-tools/bin/python scripts/waste-dataset.py seed-trashnet --limit 2444
.data/vision-tools/bin/python scripts/waste-dataset.py seed-taco --limit 1000
.data/vision-tools/bin/python scripts/waste-dataset.py condition-crops
.data/vision-tools/bin/python scripts/waste-dataset.py validate
.data/vision-tools/bin/python scripts/waste-dataset.py split
.data/vision-tools/bin/python scripts/waste-dataset.py report
.data/vision-tools/bin/python scripts/waste-dataset.py labelstudio
```

The requested mix totals3,500 before any additional cross-source duplicate exclusions. Inspect the generated `coverage.json`, source download-status files and manifest; the actual downloaded and unique counts are authoritative. Downloads are bounded, source snapshots are hashed and preparation resumes existing records without overwriting reviewed labels.

## Local annotation workspace

```sh
uv venv .data/annotation-tools --python 3.12
uv pip install --python .data/annotation-tools/bin/python -r scripts/annotation-tools-requirements.txt
.data/vision-tools/bin/python scripts/annotation-workspace.py start
.data/vision-tools/bin/python scripts/annotation-workspace.py sync
```

Open `http://127.0.0.1:9090`. The generated local account credentials are in private `.data/label-studio-login.json` (mode0600). Label Studio binds to loopback, serves files only from the dataset root, and has analytics disabled. Its account and SQLite database are separate from Supabase and the website. No paid service or cloud annotation account is created.

Four queues are prepared: source-proposal review; independent Pilot A and B using the same frozen20 images without proposed boxes; and bin-condition crops. Use different reviewers/accounts for the two pilot passes. Two passes by the same person do not establish independent agreement.

For object images, inspect every supported visible object, correct boxes, add missing parts and resolve or remove every source-only region. Record material as unknown unless supported by a product/marking reference. Review visibility, scene domain, source rights, related-image grouping and completeness. A genuinely empty/unsupported scene needs explicit negative confirmation. Do not accept an ambiguous possible target as background.

For each bin crop, verify that it contains one supported bin and enough context to inspect the opening and spillage origin. Choose normal, full without overflow, or overflowing only when visually established. An obscured opening or uncertain source of ground litter is unverifiable, stored as null plus a reason and excluded from supervised condition export. Edited parent boxes invalidate old crops.

Export submitted annotations as Label Studio JSON, then import them deliberately:

```sh
.data/vision-tools/bin/python scripts/waste-dataset.py compare-pilot pilot-a.json pilot-b.json
.data/vision-tools/bin/python scripts/waste-dataset.py import-labelstudio reviewed-export.json
.data/vision-tools/bin/python scripts/waste-dataset.py validate
.data/vision-tools/bin/python scripts/waste-dataset.py export --output .data/waste-dataset/exports/reviewed-v1
```

Predictions alone never enter the accepted set. Conflicting/multiple annotations require reconciliation, not a latest-wins import. Pilot box agreement is not an accuracy score; reconcile attributes and taxonomy disagreements too.

## Splits, exports and checks

Session, physical-item, site and exact/near-duplicate relationships form transitive groups. Unknown source sites are conservatively grouped by batch/author; TrashNet's unknown common capture setup stays together. This can yield unequal split sizes and missing class/split coverage. Do not weaken grouping to manufacture a clean70/15/15 split. Resolve source/site information during review.

Assignments are frozen and append-only; a later relationship connecting different frozen splits blocks export. An intentional collection-version change must retain the old ledger and explain any reassignment. Earlier COCO validation and smoke/demo images are reserved, including duplicate checks; they are not imported as training examples.

Reviewed exports contain YOLO zero-based IDs, RF-DETR-compatible COCO `train/valid/test` folders with explicit one-based category mappings, separate condition-class folders with canonical-ID prefixes, and full provenance/material/group/review sidecars. Images are copied into immutable version folders. No model is trained or activated merely because an export exists.

```sh
.data/vision-tools/bin/python -m unittest discover -s tests/training -v
```

These tests exercise leakage, invalid boxes/materials, unreviewed negatives, benchmark reservations, prediction-only imports, ID mappings, immutable exports and bin-crop lineage. Phone latency and held-out waste-recognition accuracy must be remeasured after actual training. The source collection still needs more representative Toronto bins and sufficient reviewed examples of rare classes before full40-class coverage can be claimed.
