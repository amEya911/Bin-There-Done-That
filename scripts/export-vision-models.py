"""Reproduce the two untrained-on-our-data browser baselines. See docs/local-vision-test.md.

Run with the isolated .data/vision-tools Python environment. Downloads official public
checkpoints, never application credentials or user images. No training or cloud jobs.
"""
from pathlib import Path
import hashlib
import importlib.metadata
import json
import os
import shutil
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".data/model-export"
DEST = ROOT / "public/models/vision"
WORK.mkdir(parents=True, exist_ok=True)
DEST.mkdir(parents=True, exist_ok=True)
os.environ["RF_HOME"] = str(WORK)
os.environ["YOLO_CONFIG_DIR"] = str(WORK / "ultralytics-config")


def record(name, path, source, license_name, size, decoder):
    import onnx
    import onnxruntime as ort
    model = onnx.load(path, load_external_data=True)
    onnx.save_model(model, path, save_as_external_data=False)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    target = DEST / f"{name}-{digest[:12]}.onnx"
    shutil.copyfile(path, target)
    session = ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
    entry = {
        "id": name, "url": "/models/vision/" + target.name,
        "bytes": target.stat().st_size, "sha256": digest,
        "source": source, "license": license_name, "size": size, "decoder": decoder,
        "input": session.get_inputs()[0].name,
        "outputs": {x.name: x.shape for x in session.get_outputs()},
        "versions": {p: importlib.metadata.version(p) for p in
                     ["torch", "onnx", "ultralytics", "rfdetr"]},
    }
    (DEST / f"{name}.json").write_text(json.dumps(entry, indent=2) + "\n")
    package, license_file = ("ultralytics", "LICENSE-YOLO.txt") if name == "yolo26n" else ("rfdetr", "LICENSE-RF-DETR.txt")
    dist = importlib.metadata.distribution(package)
    for file in dist.files or []:
        if str(file).endswith(".dist-info/licenses/LICENSE"):
            shutil.copyfile(dist.locate_file(file), DEST / license_file)
            break
    print(json.dumps(entry, indent=2), flush=True)


which = sys.argv[1] if len(sys.argv) > 1 else "all"
if which in ("all", "yolo26n"):
    from ultralytics import YOLO
    source = "https://huggingface.co/Ultralytics/YOLO26/resolve/main/yolo26n.pt"
    checkpoint = WORK / "yolo26n.pt"
    if not checkpoint.exists():
        urllib.request.urlretrieve(source, checkpoint)
    expected = "9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef"
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != expected:
        raise RuntimeError("YOLO checkpoint differs from the verified baseline. Review the source before exporting.")
    # Raw one-to-many head, decoded and class-aware NMS in our worker.
    # nms=None explicitly disables the YOLO26 end-to-end TopK export branch.
    path = YOLO(str(checkpoint)).export(format="onnx", imgsz=640, opset=17,
                                       simplify=False, dynamic=False, nms=None,
                                       device="cpu", half=False)
    record("yolo26n", Path(path), source, "AGPL-3.0", 640, "yolo-raw")

if which in ("all", "rfdetr-nano"):
    from rfdetr import RFDETRNano
    from rfdetr.assets.model_weights import ModelWeights
    source = ModelWeights.RF_DETR_NANO.url
    model = RFDETRNano(device="cpu")
    path = model.export(output_dir=str(WORK / "rfdetr"), opset_version=17,
                        shape=(384, 384), batch_size=1, dynamic_batch=False,
                        verbose=False, fp16=False)
    record("rfdetr-nano", Path(path), source, "Apache-2.0", 384, "rfdetr")
