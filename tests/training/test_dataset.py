from copy import deepcopy
import json
from pathlib import Path
import random
import sys
import tempfile
import unittest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from waste_data.core import CLASSES, REVIEW_SENTINEL, image_fingerprint, initialize, issues, make_groups, read_jsonl, split_records, write_json, write_jsonl
from waste_data.export import export_dataset
from waste_data.labelstudio import import_reviews, tasks


class DatasetChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.home = initialize(Path(self.temp.name) / "dataset")

    def tearDown(self): self.temp.cleanup()

    def sample(self, identity="one", label="cup_body", accepted=True):
        rng = random.Random(identity); image = Image.new("RGB", (80, 60))
        image.putdata([(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(80 * 60)])
        path = self.home / "images" / (identity + ".png"); image.save(path)
        return {"id": identity, "image": {"path": str(path.relative_to(self.home)), **image_fingerprint(path)}, "source": {"url": "https://example.test/" + identity, "license": "CC0-1.0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/", "attribution": "Synthetic test fixture"}, "groups": {"session": identity, "entity": identity, "site": identity}, "domain": "physical_scene", "domainReviewed": accepted, "boxes": [{"id": "body", "label": label, "bbox": [8, 12, 40, 30], "material": "unknown", "materialBasis": "unknown", "visibility": "clear", "visibilityReviewed": accepted}], "review": {"state": "accepted" if accepted else "pending", "complete": accepted, "rightsChecked": accepted, "groupingChecked": accepted, "reviewer": "test-reviewer" if accepted else None, "reviewedAt": "2026-10-24" if accepted else None, "confirmedNegative": False, "unresolvedTargets": False}}

    def test_part_boxes_keep_true_extents_and_reject_bad_materials(self):
        r = self.sample(); r["boxes"][0]["bbox"] = [1, 1, .1, 25]
        self.assertEqual(issues(r, self.home), [])  # Honest thin straw-like box, no padding.
        r["boxes"][0]["material"] = "rigid_plastic"
        self.assertIn("material_without_evidence", issues(r, self.home))
        r["boxes"][0]["bbox"] = [79, 1, 2, 2]
        self.assertIn("invalid_box", issues(r, self.home))

    def test_unknown_regions_and_incomplete_negatives_cannot_be_accepted(self):
        r = self.sample(); r["boxes"][0]["label"] = REVIEW_SENTINEL
        self.assertIn("unresolved_source_region", issues(r, self.home))
        r["boxes"] = []
        self.assertIn("unconfirmed_negative", issues(r, self.home))
        r["review"]["confirmedNegative"] = True
        self.assertEqual(issues(r, self.home), [])

    def test_related_groups_are_transitive_and_frozen_conflicts_fail(self):
        a, b, c = [self.sample(x) for x in ["a", "b", "c"]]
        a["groups"]["session"] = b["groups"]["session"] = "video1"
        b["groups"]["entity"] = c["groups"]["entity"] = "same-bin"
        self.assertEqual(len(make_groups([a, b, c])), 1)
        splits = split_records([a, b, c]); self.assertEqual(len(set(splits.values())), 1)
        with self.assertRaisesRegex(ValueError, "crosses frozen"):
            split_records([a, b, c], {"a": "train", "c": "test"})

    def test_exact_and_near_duplicate_images_stay_together(self):
        a, b = self.sample("a"), self.sample("b")
        b["image"]["pixelSha256"] = a["image"]["pixelSha256"]
        self.assertEqual(len(make_groups([a, b])), 1)
        b["image"]["pixelSha256"] = "different"
        b["image"]["dhash256"] = f"{int(a['image']['dhash256'], 16) ^ 1:064x}"
        self.assertEqual(len(make_groups([a, b])), 1)

    def test_reserved_benchmark_image_cannot_be_reintroduced(self):
        r = self.sample()
        write_json(self.home / "evaluation-reservations.json", [r["image"]])
        r["reservedEvaluation"] = False
        self.assertIn("reserved_evaluation_not_training", issues(r, self.home))

    def test_prelabels_alone_never_become_accepted(self):
        r = self.sample(accepted=False); write_jsonl(self.home / "manifest.jsonl", [r])
        file = self.home / "proposals.json"; write_json(file, tasks([r]))
        import_reviews(self.home, file)
        self.assertEqual(read_jsonl(self.home / "manifest.jsonl")[0]["review"]["state"], "pending")
        with self.assertRaisesRegex(ValueError, "No accepted"):
            export_dataset(self.home, self.home / "exports/nope")

    def test_export_preserves_ids_metadata_and_immutable_images(self):
        r = self.sample(); write_jsonl(self.home / "manifest.jsonl", [r]); write_json(self.home / "splits.json", {r["id"]: "val"})
        output = self.home / "exports/version1"; export_dataset(self.home, output)
        self.assertEqual((output / "yolo/val/labels/one.txt").read_text(), "0 0.35000000 0.45000000 0.50000000 0.50000000\n")
        coco = json.loads((output / "coco/valid/_annotations.coco.json").read_text())
        self.assertEqual(coco["annotations"][0]["category_id"], 1)
        self.assertEqual(len(coco["categories"]), 40)
        self.assertEqual(read_jsonl(output / "metadata/objects.jsonl")[0]["source"], r["source"])
        file = output / "yolo/val/images/one.png"; frozen = file.read_bytes()
        (self.home / r["image"]["path"]).write_bytes(b"changed source")
        self.assertEqual(file.read_bytes(), frozen)
        with self.assertRaises(ValueError): export_dataset(self.home, output)

    def test_condition_cannot_create_a_fourth_class_or_detach_from_parent(self):
        r = self.sample(label="waste_bin"); write_jsonl(self.home / "manifest.jsonl", [r]); write_json(self.home / "splits.json", {r["id"]: "test"})
        c = {"id": "crop", "parentId": r["id"], "parentImageSha256": r["image"]["sha256"], "binBoxId": "body", "binBoxAtCrop": r["boxes"][0]["bbox"], "image": r["image"], "condition": None, "review": {"state": "accepted", "reviewer": "test", "openingVisible": True, "spillageOriginChecked": True}}
        write_jsonl(self.home / "conditions.jsonl", [c])
        with self.assertRaisesRegex(ValueError, "fourth"):
            export_dataset(self.home, self.home / "exports/null-label")
        c["condition"] = "overflowing"; write_jsonl(self.home / "conditions.jsonl", [c])
        output = self.home / "exports/valid-condition"; export_dataset(self.home, output)
        self.assertTrue((output / "conditions/test/2_overflowing/crop.jpg").is_file())
        c["binBoxAtCrop"] = [0, 0, 1, 1]; write_jsonl(self.home / "conditions.jsonl", [c])
        with self.assertRaisesRegex(ValueError, "parent annotation"):
            export_dataset(self.home, self.home / "exports/stale-crop")


if __name__ == "__main__": unittest.main()
