from concurrent.futures import ThreadPoolExecutor
import io
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from waste_data.archive import RangeReader, RequestPacer


class RangeResponse(io.BytesIO):
    status = 206


class ArchiveDownloadChecks(unittest.TestCase):
    def test_independent_readers_extract_correct_zip_members_concurrently(self):
        source = io.BytesIO()
        expected = {f"image-{i}.jpg": bytes(range(256)) * (i + 7) for i in range(8)}
        with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in expected.items(): archive.writestr(name, content)
        content = source.getvalue(); pacer = RequestPacer(interval=0)

        def response(request, timeout):
            start, end = map(int, re.fullmatch(r"bytes=(\d+)-(\d+)", request.get_header("Range")).groups())
            return RangeResponse(content[start:end + 1])

        def extract(name):
            with RangeReader("https://example.test/source.zip", len(content), pacer) as reader:
                with zipfile.ZipFile(reader) as archive:
                    return archive.read(name)

        with patch("waste_data.archive.urllib.request.urlopen", side_effect=response):
            with ThreadPoolExecutor(max_workers=4) as pool:
                actual = list(pool.map(extract, expected))
        self.assertEqual(actual, list(expected.values()))

    def test_ignored_ranges_and_large_reads_cannot_download_the_full_archive(self):
        response = RangeResponse(b"entire archive"); response.status = 200
        with patch("waste_data.archive.urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(ValueError, "refusing full"):
                RangeReader("https://example.test/source.zip", 2_700_000_000).read(10)
        with patch("waste_data.archive.urllib.request.urlopen") as request:
            with self.assertRaisesRegex(ValueError, "bounded"):
                RangeReader("https://example.test/source.zip", 2_700_000_000).read(33 * 1024 * 1024)
            request.assert_not_called()

    def test_source_backoff_is_shared_and_not_shortened(self):
        error = urllib.error.HTTPError("https://example.test/source.zip", 429, "Retry later", {"Retry-After": "120"}, None)
        pacer = unittest.mock.Mock()
        with patch("waste_data.archive.urllib.request.urlopen", side_effect=[error, RangeResponse(b"abc")]):
            self.assertEqual(RangeReader("https://example.test/source.zip", 3, pacer).read(3), b"abc")
        pacer.defer.assert_called_once_with(120)
        self.assertEqual(pacer.wait.call_count, 2)


if __name__ == "__main__": unittest.main()
