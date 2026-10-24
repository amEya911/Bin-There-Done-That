import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("annotation_workspace", SCRIPTS / "annotation-workspace.py")
workspace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workspace)


class AnnotationPaginationChecks(unittest.TestCase):
    def test_reads_all_pages_beyond_the_old_thousand_task_limit(self):
        rows = [{"id": i, "data": {"dataset_id": f"image-{i}"}} for i in range(3500)]

        def response(path):
            query = parse_qs(urlsplit(path).query)
            page, size = int(query["page"][0]), int(query["page_size"][0])
            return {"total": len(rows), "tasks": rows[(page - 1) * size:page * size]}

        with patch.object(workspace, "api", side_effect=response) as request:
            self.assertEqual(workspace.task_ids(2), {r["data"]["dataset_id"] for r in rows})
            self.assertEqual(request.call_count, 14)

    def test_repeated_page_cannot_silently_skip_existing_tasks(self):
        response = {"total": 2, "tasks": [{"id": 1, "data": {"dataset_id": "one"}}]}
        with patch.object(workspace, "api", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "repeated"):
                workspace.task_ids(2)

    def test_short_page_and_changed_count_require_retry(self):
        first = {"total": 2, "tasks": [{"id": 1, "data": {"dataset_id": "one"}}]}
        for later, message in [({"total": 2, "tasks": []}, "Incomplete"), ({"total": 3, "tasks": []}, "changed")]:
            with self.subTest(message=message), patch.object(workspace, "api", side_effect=[first, later]):
                with self.assertRaisesRegex(RuntimeError, message):
                    workspace.task_ids(2)


if __name__ == "__main__": unittest.main()
