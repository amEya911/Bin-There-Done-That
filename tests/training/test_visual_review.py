"""Review decisions must be tied to the images and proposals actually viewed."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from waste_data.core import image_fingerprint, initialize, read_jsonl, write_json, write_jsonl

spec = importlib.util.spec_from_file_location("visual_review", SCRIPTS / "review-waste-labels.py")
visual_review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visual_review)


class VisualReviewChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = initialize(Path(self.temp.name) / "dataset")
        image = self.home / "images/one.png"
        Image.new("RGB", (80, 60), "orange").save(image)
        self.record = {
            "id": "one", "image": {"path": "images/one.png", **image_fingerprint(image)},
            "source": {"url": "https://example.test/one", "license": "CC0-1.0",
                       "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
                       "attribution": "Synthetic test fixture"},
            "groups": {"session": "one", "entity": "one", "site": "one"},
            "domain": "physical_scene", "domainReviewed": False,
            "boxes": [], "review": {"state": "pending"},
        }
        write_jsonl(self.home / "manifest.jsonl", [self.record])
        self.proposal = {"id": "one", "imageSha256": self.record["image"]["sha256"],
                         "boxes": [{"label": "cup_body", "bbox": [8, 12, 40, 30]}]}
        write_jsonl(self.home / "auto-labels/florence-proposals.jsonl", [self.proposal])
        self.sheet = self.home / "reviews/sheet.png"
        Image.new("RGB", (100, 100), "white").save(self.sheet)
        digest = hashlib.sha256(json.dumps(self.proposal, sort_keys=True).encode()).hexdigest()
        write_json(self.sheet.with_suffix(".json"), [{"id": "one", "proposalSha256": digest}])
        self.decision = self.home / "reviews/decisions.json"
        write_json(self.decision, {"sheet": str(self.sheet), "images": [
            {"id": "one", "decision": "accept", "boxSource": "florence", "note": "Visible cup body reviewed."}
        ]})

    def tearDown(self):
        self.temp.cleanup()

    def test_ai_review_records_identity_and_does_not_assert_material(self):
        visual_review.apply(self.home, self.decision)
        result = read_jsonl(self.home / "manifest.jsonl")[0]
        self.assertFalse(result["review"]["humanVerified"])
        self.assertEqual(result["review"]["method"], "single_ai_visual_reviewer")
        self.assertEqual(result["boxes"][0]["material"], "unknown")
        events = list((self.home / "reviews").glob("*-codex.jsonl"))
        self.assertEqual(len(events), 1)
        self.assertEqual(read_jsonl(events[0])[0]["before"], self.record)

    def test_a_changed_proposal_cannot_be_accepted_from_an_old_sheet(self):
        self.proposal["boxes"][0]["label"] = "bottle"
        write_jsonl(self.home / "auto-labels/florence-proposals.jsonl", [self.proposal])
        with self.assertRaisesRegex(ValueError, "Proposals changed"):
            visual_review.apply(self.home, self.decision)
        self.assertEqual(read_jsonl(self.home / "manifest.jsonl")[0], self.record)

    def test_an_unseen_image_cannot_be_marked_reviewed(self):
        write_json(self.sheet.with_suffix(".json"), [])
        with self.assertRaisesRegex(ValueError, "not on the declared review sheet"):
            visual_review.apply(self.home, self.decision)
        self.assertEqual(read_jsonl(self.home / "manifest.jsonl")[0], self.record)


if __name__ == "__main__":
    unittest.main()
