"""Real browser inference smoke test. Uses a synthetic camera, never the Mac webcam.

Requires Playwright in the isolated vision-tools environment and an already
running production preview on port3003. Set VISION_BROWSER to a headless Chromium.
"""
from pathlib import Path
import base64
import json
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/vision-verification"
OUT.mkdir(parents=True, exist_ok=True)
SHOTS = ROOT / ".impeccable/review/local-vision"
SHOTS.mkdir(parents=True, exist_ok=True)
FIXTURE = ROOT / "tests/fixtures/vision/coffee-cup.jpg"
BASE = os.environ.get("VISION_TEST_URL", "http://127.0.0.1:3003/scan/test")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ["VISION_BROWSER"])
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, color_scheme="light", accept_downloads=True)
    page = context.new_page()
    errors, writes = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: writes.append(r.url) if r.method not in ("GET", "HEAD") else None)
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    assert not page.locator("video").evaluate("v => !!v.srcObject")
    page.screenshot(path=str(SHOTS / "desktop-light-idle.png"), full_page=True)
    results = {}
    for model in ("yolo26n", "rfdetr-nano"):
        page.get_by_label("Test model", exact=True).select_option(model)
        page.get_by_label("Choose a test photo").set_input_files(str(FIXTURE))
        page.wait_for_function("document.querySelector('dd')?.textContent !== '—' || !!document.querySelector('main [role=alert]')", timeout=60000)
        assert not page.locator("main [role=alert]").count(), page.locator("main [role=alert]").inner_text() if page.locator("main [role=alert]").count() else ""
        assert page.locator('[class*="box"] > span').count() > 0, "Actual model returned no objects for fixture"
        with page.expect_download() as download_info:
            page.get_by_role("button", name="Save test results").click()
        download = download_info.value
        download.save_as(str(OUT / f"{model}-photo.json"))
        data = json.loads((OUT / f"{model}-photo.json").read_text())
        assert "cup" in data["samples"][0]["detected"], data
        results[model] = data
        page.screenshot(path=str(SHOTS / f"desktop-light-{model}.png"), full_page=True)
        print(model, "photo seconds", round(data["p50Ms"] / 1000, 3), "detected", data["samples"][0]["detected"], flush=True)

    page.get_by_label("Test model", exact=True).select_option("yolo26n")
    encoded = base64.b64encode(FIXTURE.read_bytes()).decode()
    page.evaluate("""async data => {
      const image = new Image(); image.src = 'data:image/jpeg;base64,' + data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      window.fixtureCamera = { canvas, ctx, calls: 0, streams: [], blank: false };
      function draw() {
        ctx.fillStyle='#ddd'; ctx.fillRect(0,0,640,480);
        if (!window.fixtureCamera.blank) ctx.drawImage(image,190,5,260,470);
        requestAnimationFrame(draw);
      } draw();
      navigator.mediaDevices.getUserMedia = async () => {
        window.fixtureCamera.calls++;
        const stream=canvas.captureStream(12); window.fixtureCamera.streams.push(stream); return stream;
      };
    }""", encoded)
    assert page.evaluate("window.fixtureCamera.calls") == 0
    page.get_by_role("button", name="Start camera", exact=True).click()
    page.wait_for_function("Number(document.querySelectorAll('dd')[3]?.textContent) >= 20", timeout=60000)
    assert page.locator('[class*="box"] > span').count() > 0
    with page.expect_download() as download_info:
        page.get_by_role("button", name="Save test results").click()
    download_info.value.save_as(str(OUT / "yolo26n-synthetic-camera.json"))
    results["syntheticCamera"] = json.loads((OUT / "yolo26n-synthetic-camera.json").read_text())
    page.screenshot(path=str(SHOTS / "desktop-light-live.png"), full_page=True)
    page.evaluate("window.fixtureCamera.blank = true")
    page.wait_for_function("document.querySelectorAll('[class*=box] > span').length === 0", timeout=10000)
    page.get_by_role("button", name="Stop camera", exact=True).click()
    assert page.evaluate("window.fixtureCamera.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")

    # A permission request completing after Stop must not resurrect the camera.
    page.evaluate("""() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
        window.resolvePermission = () => {
          const stream=window.fixtureCamera.canvas.captureStream(12);
          window.fixtureCamera.streams.push(stream); resolve(stream);
        };
      });
    }""")
    page.get_by_role("button", name="Start camera", exact=True).click()
    page.get_by_role("button", name="Stop camera", exact=True).click()
    page.evaluate("window.resolvePermission()")
    page.wait_for_function("window.fixtureCamera.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")
    assert not page.locator("video").evaluate("v=>!!v.srcObject")

    for theme in ("light", "dark"):
        page.emulate_media(color_scheme=theme)
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_label("Choose a test photo").set_input_files(str(FIXTURE))
        page.wait_for_function("document.querySelector('dd')?.textContent !== '—' && !document.querySelector('[aria-busy=true]')", timeout=30000)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=str(SHOTS / f"mobile-{theme}-photo.png"), full_page=True)
    assert not errors, errors
    assert not writes, writes
    results["verification"] = {"noCameraOnOpen": True, "latePermissionCleanedUp": True, "tracksStopped": True, "absentObjectRemoved": True, "pageErrors": errors, "networkWrites": writes, "physicalPhoneTested": False}
    (OUT / "summary.json").write_text(json.dumps(results, indent=2))
    print("PASS: real photo inference, 20 live fixture frames, disappearing objects, camera cancellation, themes, no network writes", flush=True)
    browser.close()
