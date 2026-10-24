"""Bounded range reader for the official public TACO release archive."""
import io
import time
import urllib.request
import urllib.error


class RangeReader(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.pos = url, size, 0
        self.cache_start, self.cache = 0, b""
        self.prefetch = {}; self.last_request = 0

    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, size=-1):
        size = min(size if size >= 0 else self.size, self.size - self.pos)
        if size <= 0: return b""
        end = self.pos + size
        if self.cache_start <= self.pos and end <= self.cache_start + len(self.cache):
            out = self.cache[self.pos - self.cache_start:end - self.cache_start]; self.pos = end; return out
        amount = min(self.size - self.pos, max(size, self.prefetch.get(self.pos, 0)))
        if amount > 32 * 1024 * 1024: raise ValueError("Archive member exceeds bounded local download size")
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + amount - 1}"})
        for attempt in range(3):
            time.sleep(max(0, .5 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    if response.status != 206: raise ValueError("Archive did not honor range request; refusing full2.7GB download")
                    body = response.read(amount + 1)
                if len(body) != amount:
                    if attempt < 2: continue
                    raise ValueError("Incomplete archive byte range")
                break
            except urllib.error.HTTPError as error:
                if error.code != 429 or attempt == 2: raise
                time.sleep(min(60, max(1, int(error.headers.get("Retry-After", "30")))))
        self.cache_start, self.cache = self.pos, body
        out = body[:size]; self.pos += len(out); return out
