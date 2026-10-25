"""Train a source-supervised first detector; source labels remain distinct from the full app catalog."""
import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import re
import shutil
import time

from PIL import Image
from waste_data.core import ROOT, CONFIG, CLASSES, issues, now, read_jsonl, sha, write_json, write_jsonl, split_records

HOME = ROOT / CONFIG["dataRoot"]
RUN = ROOT / ".data/waste-training"
DATA = RUN / "source-supervised-v1"
CHECKPOINT = ROOT / ".data/model-export/yolo26n.pt"


def prepare():
    if DATA.exists(): raise ValueError("Frozen experiment already exists; use it without overwriting")
    records = read_jsonl(HOME / "manifest.jsonl")
    ledger = json.loads((HOME / "splits.json").read_text()); split_records(records, ledger)
    source_file = HOME / "sources/taco-annotations.json"
    source = json.loads(source_file.read_text())
    pinned = json.loads((ROOT / "training/taco-label-map.json").read_text())
    selected = [r for r in records if r["source"]["dataset"] == "TACO"]
    if any(r["source"]["annotationSha256"] != sha(source_file) for r in selected): raise ValueError("Source annotation snapshot changed")
    if any(r.get("qualityHold") for r in selected): raise ValueError("Source image geometry requires review")
    categories = sorted(source["categories"], key=lambda c: c["id"])
    source_to_model = {c["id"]: i for i, c in enumerate(categories)}
    names = [re.sub(r"[^a-z0-9]+", "_", c["name"].lower()).strip("_") for c in categories]
    metadata = [{"modelId": i, "name": names[i], "sourceName": c["name"], "sourceCategoryId": c["id"], "canonicalSuggestion": pinned["mapping"][c["name"]], "requiresSubtypeReview": c["name"] in ["Other plastic bottle", "Clear plastic bottle", "Glass bottle"], "labelOrigin": "TACO original published annotations"} for i,c in enumerate(categories)]
    by_image = defaultdict(list)
    for a in source["annotations"]: by_image[a["image_id"]].append(a)
    extras = [r for r in records if r["source"]["dataset"] != "TACO" and r["review"]["state"] == "accepted"]
    extra_labels = sorted({b["label"] for r in extras for b in r["boxes"]}, key=CLASSES.get)
    extra_ids = {}
    # Keep the original sixty source categories intact; no forced relabeling of ambiguous source objects.
    for label in extra_labels:
        extra_ids[label] = len(names); names.append("app_" + label)
        metadata.append({"modelId": extra_ids[label], "name": names[-1], "canonicalSuggestion": label, "labelOrigin": "Codex single AI visual review; not independent human verification"})
    if len(names) != len(set(names)): raise ValueError("Duplicate model class names")
    rows = []
    for r in selected:
        rows.append((r, [(source_to_model[a["category_id"]], a["bbox"]) for a in by_image[r["source"]["sourceImageId"]]], "original_source_annotations"))
    for r in extras:
        if problems := issues(r, HOME): raise ValueError("Reviewed supplement failed: " + str(problems))
        rows.append((r, [(extra_ids[b["label"]], b["bbox"]) for b in r["boxes"]], "single_ai_visual_review"))
    DATA.mkdir(parents=True)
    audit = []; counts = Counter(); class_counts = {s: Counter() for s in ["train", "val", "test"]}
    try:
        for r, boxes, origin in rows:
            split = ledger[r["id"]]; counts[split] += 1
            image_file = HOME / r["image"]["path"]
            if sha(image_file) != r["image"]["sha256"]: raise ValueError("Image changed after annotation")
            destination = DATA / "images" / split / (r["id"] + ".jpg"); destination.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(image_file) as im:
                display = im.convert("RGB"); display.thumbnail((1024,1024), Image.Resampling.LANCZOS); display.save(destination, quality=94)
            w,h = r["image"]["width"],r["image"]["height"]
            labels = []
            for label,bbox in boxes:
                x,y,bw,bh = bbox; left,top = max(0,x),max(0,y); right,bottom = min(w,x+bw),min(h,y+bh)
                if right<=left or bottom<=top: raise ValueError("Invalid source box")
                labels.append(f"{label} {(left+right)/2/w:.8f} {(top+bottom)/2/h:.8f} {(right-left)/w:.8f} {(bottom-top)/h:.8f}")
                class_counts[split][names[label]] += 1
            label_file = DATA / "labels" / split / (r["id"] + ".txt"); label_file.parent.mkdir(parents=True, exist_ok=True); label_file.write_text("\n".join(labels) + ("\n" if labels else ""))
            audit.append({"id":r["id"],"split":split,"sourceImageSha256":r["image"]["sha256"],"trainingImageSha256":sha(destination),"labelOrigin":origin,"source":r["source"],"groups":r["groups"],"boxes":boxes})
        for split in ["train","val","test"]:
            (DATA/"images"/split).mkdir(parents=True,exist_ok=True);(DATA/"labels"/split).mkdir(parents=True,exist_ok=True)
            if not counts[split]: raise ValueError("Experiment needs populated grouped train/validation/test splits")
        write_json(DATA/"data.yaml",{"path":str(DATA),"train":"images/train","val":"images/val","test":"images/test","names":names})
        write_json(DATA/"class-map.json",metadata)
        write_jsonl(DATA/"provenance.jsonl",audit)
        write_json(DATA/"manifest.json",{"createdAt":now(),"sourceAnnotationSha256":sha(source_file),"sourceAnnotationRevision":pinned["annotationRevision"],"labelPolicy":"Original published TACO vocabulary and boxes plus separately identified visually reviewed app supplements. Experimental; not a claim that all 40 app classes are annotated or verified.","images":len(rows),"splits":dict(counts),"classes":len(names),"classCounts":{s:dict(v) for s,v in class_counts.items()},"runtimeEnabled":False,"overflowClassifierTrained":False})
    except Exception:
        shutil.rmtree(DATA);raise
    print(json.dumps({"dataset":str(DATA),"images":len(rows),"splits":dict(counts),"classes":len(names)},indent=2),flush=True)


def train(epochs=30,batch=8,imgsz=512,name="yolo26n-source-v1"):
    import torch
    os.environ["YOLO_CONFIG_DIR"]=str(RUN/"ultralytics-config")
    os.environ["YOLO_AUTOINSTALL"]="False"
    os.environ["WANDB_MODE"]="disabled"
    from ultralytics import YOLO, settings
    settings.update({key:False for key in ["sync","wandb","mlflow","comet","clearml","neptune","tensorboard"] if key in settings})
    if not (DATA/"manifest.json").exists(): raise ValueError("Prepare the frozen experiment first")
    if not CHECKPOINT.exists(): raise ValueError("Verified pretrained checkpoint is missing")
    if sha(CHECKPOINT)!="9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef": raise ValueError("Pretrained checkpoint changed")
    device="mps" if torch.backends.mps.is_available() else "cpu"
    originals={r["id"]:r for r in read_jsonl(HOME/"manifest.jsonl")}
    reserved=json.loads((HOME/"evaluation-reservations.json").read_text())
    for row in read_jsonl(DATA/"provenance.jsonl"):
        image=originals[row["id"]]["image"]
        for sample in reserved:
            if image["pixelSha256"]==sample["pixelSha256"] or (int(image["dhash256"],16)^int(sample["dhash256"],16)).bit_count()<=CONFIG["nearDuplicateHammingDistance"]:
                raise ValueError("Reserved benchmark or possible near duplicate entered the experiment: "+row["id"])
        if sha(DATA/"images"/row["split"]/(row["id"]+".jpg"))!=row["trainingImageSha256"]:
            raise ValueError("Frozen experiment image changed")
    directory=RUN/name
    if directory.exists(): raise ValueError("Choose a new run name; do not overwrite a training run")
    write_json(RUN/(name+"-request.json"),{"createdAt":now(),"datasetSha256":sha(DATA/"manifest.json"),"epochs":epochs,"batch":batch,"imgsz":imgsz,"device":device,"pretrainedSha256":sha(CHECKPOINT),"runtimeEnabled":False})
    model=YOLO(str(CHECKPOINT))
    model.train(data=str(DATA/"data.yaml"),epochs=epochs,batch=batch,imgsz=imgsz,device=device,workers=2,cache=False,project=str(RUN),name=name,seed=CONFIG["seed"],patience=10,save=True,save_period=-1,plots=True,amp=False,close_mosaic=min(10,epochs//3),verbose=False)
    print("Training completed:",directory,flush=True)


def evaluate(name):
    from ultralytics import YOLO
    import torch
    weights=RUN/name/"weights/best.pt"
    if not weights.exists():raise ValueError("No completed training checkpoint")
    model=YOLO(str(weights))
    previous=RUN/name/"heldout-summary.json"
    if previous.exists() and not (RUN/name/"heldout-summary-end2end.json").exists():shutil.copyfile(previous,RUN/name/"heldout-summary-end2end.json")
    result=model.val(data=str(DATA/"data.yaml"),split="test",imgsz=512,batch=4,device="mps" if torch.backends.mps.is_available() else "cpu",workers=0,plots=True,end2end=False,project=str(RUN),name=name+"-heldout-raw",exist_ok=False,verbose=False)
    write_json(RUN/name/"heldout-summary.json",{"evaluatedAt":now(),"weightsSha256":sha(weights),"datasetManifestSha256":sha(DATA/"manifest.json"),"split":"frozen_test","inferenceHead":"one_to_many_raw_with_NMS_matching_browser_export","metrics":{k:float(v) for k,v in result.results_dict.items()},"speedMs":result.speed,"runtimeEnabled":False,"limitations":["Published-source labels; not an independent Toronto field evaluation.","Additional app classes have few reviewed examples; per-class support must be inspected.","No bin-condition classifier or automatic reporting activation."]})
    print(json.dumps(result.results_dict,indent=2),flush=True)


def export_model(name):
    import onnx
    import onnxruntime as ort
    from ultralytics import YOLO
    weights=RUN/name/"weights/best.pt"
    if not weights.exists(): raise ValueError("Train a checkpoint before exporting")
    model=YOLO(str(weights)); class_names=[model.names[i] for i in range(len(model.names))]
    exported=Path(model.export(format="onnx",imgsz=512,opset=17,simplify=False,dynamic=False,nms=None,device="cpu",half=False))
    graph=onnx.load(exported,load_external_data=True);onnx.checker.check_model(graph)
    onnx.save_model(graph,exported,save_as_external_data=False)
    digest=sha(exported); identifier="waste-yolo26n-v1"; destination=ROOT/"public/models/vision"/(identifier+"-"+digest[:12]+".onnx")
    shutil.copyfile(exported,destination)
    session=ort.InferenceSession(str(destination),providers=["CPUExecutionProvider"])
    shape=session.get_outputs()[0].shape
    if len(shape)!=3 or shape[1]!=4+len(class_names):raise ValueError("Export output no longer matches the raw YOLO browser decoder")
    import numpy as np
    outputs=session.run(None,{session.get_inputs()[0].name:np.zeros((1,3,512,512),dtype=np.float32)})
    if not np.isfinite(outputs[0]).all():raise ValueError("Non-finite exported model outputs")
    evaluation=RUN/name/"heldout-summary.json"
    if not evaluation.exists():raise ValueError("Evaluate the trained checkpoint before publishing a preview manifest")
    measured=json.loads(evaluation.read_text())
    if measured["weightsSha256"]!=sha(weights):raise ValueError("Held-out results refer to different weights")
    spec={"id":identifier,"url":"/models/vision/"+destination.name,"bytes":destination.stat().st_size,"sha256":digest,"size":512,"decoder":"yolo-raw","input":session.get_inputs()[0].name,"outputs":{x.name:x.shape for x in session.get_outputs()},"classNames":class_names,"classMap":json.loads((DATA/"class-map.json").read_text()),"source":"Local fine-tuning of verified YOLO26 Nano checkpoint","license":"AGPL-3.0","trainingDatasetSha256":sha(DATA/"manifest.json"),"trainingWeightsSha256":sha(weights),"status":"experimental_detector","heldoutMetrics":measured["metrics"],"productionReady":False,"overflowClassifierTrained":False,"automaticReportingEnabled":False}
    write_json(destination.parent/(identifier+".json"),spec)
    print("Exported browser checkpoint:",destination,flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="command",required=True)
    sub.add_parser("prepare")
    p=sub.add_parser("train");p.add_argument("--epochs",type=int,default=30);p.add_argument("--batch",type=int,default=8);p.add_argument("--imgsz",type=int,default=512);p.add_argument("--name",default="yolo26n-source-v1")
    p=sub.add_parser("evaluate");p.add_argument("--name",default="yolo26n-source-v1")
    p=sub.add_parser("export-model");p.add_argument("--name",default="yolo26n-source-v1")
    a=parser.parse_args()
    if a.command=="prepare":prepare()
    elif a.command=="train":train(a.epochs,a.batch,a.imgsz,a.name)
    elif a.command=="evaluate":evaluate(a.name)
    else:export_model(a.name)
