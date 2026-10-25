"""Use category-only photos honestly as classification supervision, with grouped external validation."""
import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import random
import shutil

from PIL import Image
from waste_data.core import ROOT,CONFIG,now,sha,read_jsonl,write_json,write_jsonl,split_records

HOME=ROOT/CONFIG["dataRoot"]
RUN=ROOT/".data/waste-training"
DATA=RUN/"waste-group-classification-v2"
MODEL_RUN="yolo26n-waste-groups-v2"
HELD={"trashnet-trash14","trashnet-trash89"}
GROUPS=["cardboard","glass","metal","paper","plastic","trash"]
# These are source-category transfer labels, not verified material or Toronto disposal rules.
SOURCE_GROUPS={
    "Corrugated carton":"cardboard","Pizza box":"cardboard","Other carton":"cardboard","Egg carton":"cardboard","Toilet tube":"cardboard",
    "Glass bottle":"glass","Glass cup":"glass","Glass jar":"glass","Broken glass":"glass",
    "Aluminium foil":"metal","Food Can":"metal","Aerosol":"metal","Drink can":"metal","Metal bottle cap":"metal","Metal lid":"metal","Pop tab":"metal","Scrap metal":"metal",
    "Magazine paper":"paper","Wrapping paper":"paper","Normal paper":"paper","Paper bag":"paper",
    "Other plastic bottle":"plastic","Clear plastic bottle":"plastic","Plastic bottle cap":"plastic","Disposable plastic cup":"plastic","Other plastic cup":"plastic","Plastic lid":"plastic","Other plastic":"plastic","Plastic film":"plastic","Single-use carrier bag":"plastic","Plastic utensils":"plastic","Plastic straw":"plastic",
    "Cigarette":"trash",
}


def prepare():
    if DATA.exists():raise ValueError("Classification dataset is already frozen")
    records=read_jsonl(HOME/"manifest.jsonl");ledger=json.loads((HOME/"splits.json").read_text());split_records(records,ledger)
    source=json.loads((HOME/"sources/taco-annotations.json").read_text());names={c["id"]:c["name"] for c in source["categories"]};by_image=defaultdict(list)
    for a in source["annotations"]:by_image[a["image_id"]].append(a)
    for s in ["train","val","test"]:
        for label in GROUPS:(DATA/s/label).mkdir(parents=True,exist_ok=True)
    provenance=[];counts={s:Counter() for s in ["train","val","test"]}
    for r in records:
        if r["source"]["dataset"]!="TrashNet" or r["id"] in HELD:continue
        split=ledger[r["id"]];label=r["source"]["sourceImageLabel"]
        if label not in GROUPS:raise ValueError("Unknown source classification label")
        target=DATA/split/label/(r["id"]+".jpg");shutil.copyfile(HOME/r["image"]["path"],target);counts[split][label]+=1
        provenance.append({"id":r["id"],"parentId":r["id"],"split":split,"label":label,"labelOrigin":"TrashNet original image category; not new object boxes or verified composition","sha256":sha(target),"groups":r["groups"],"source":r["source"]})
    rng=random.Random(CONFIG["seed"]);candidates=defaultdict(list)
    for r in records:
        if r["source"]["dataset"]!="TACO":continue
        split=ledger[r["id"]]
        for a in by_image[r["source"]["sourceImageId"]]:
            label=SOURCE_GROUPS.get(names[a["category_id"]])
            if label:candidates[(split,label)].append((r,a))
    for (split,label),pool in sorted(candidates.items()):
        rng.shuffle(pool)
        for r,a in pool[:150 if split=="train" else 100]:
            x,y,w,h=a["bbox"]
            if min(w,h)<12:continue
            identity=r["id"]+f"-a{a['id']}";target=DATA/split/label/(identity+".jpg")
            with Image.open(HOME/r["image"]["path"]) as im:
                rect=[max(0,int(x-w*.08)),max(0,int(y-h*.08)),min(im.width,int(x+w*1.08+1)),min(im.height,int(y+h*1.08+1))]
                crop=im.convert("RGB").crop(rect);crop.thumbnail((512,512),Image.Resampling.LANCZOS);crop.save(target,quality=94)
            counts[split][label]+=1
            provenance.append({"id":identity,"parentId":r["id"],"split":split,"label":label,"sourceCategory":names[a["category_id"]],"labelOrigin":"Explicit TACO source category transferred to an auxiliary appearance group; not independently verified material","cropXYXY":rect,"sha256":sha(target),"groups":r["groups"],"source":r["source"]})
    parent_splits=defaultdict(set)
    for row in provenance:parent_splits[row["parentId"]].add(row["split"])
    if any(len(v)>1 for v in parent_splits.values()):raise ValueError("One parent entered multiple splits")
    write_jsonl(DATA/"provenance.jsonl",provenance)
    photo_count=sum(row["labelOrigin"].startswith("TrashNet") for row in provenance)
    write_json(DATA/"manifest.json",{"createdAt":now(),"groups":GROUPS,"counts":{s:dict(c) for s,c in counts.items()},"sourcePhotos":len(parent_splits),"trashnetPhotos":photo_count,"heldForUserClarification":sorted(HELD),"derivedCropsAreNewPhotos":False,"materialVerified":False,"disposalRulesLearned":False,"evaluation":"Grouped TACO crop transfer labels; TrashNet unknown common site remains wholly in its frozen training group.","runtimeEnabled":False})
    print(json.dumps({"dataset":str(DATA),"counts":{s:dict(c) for s,c in counts.items()},"trashnetPhotos":photo_count},indent=2),flush=True)


def train(epochs=20):
    os.environ["YOLO_CONFIG_DIR"]=str(RUN/"classifier-config");os.environ["YOLO_AUTOINSTALL"]="False";os.environ["WANDB_MODE"]="disabled"
    import torch
    from huggingface_hub import hf_hub_download,model_info
    from ultralytics import YOLO,settings
    settings.update({key:False for key in ["sync","wandb","mlflow","comet","clearml","neptune","tensorboard"] if key in settings})
    if not (DATA/"manifest.json").exists():raise ValueError("Prepare classification data first")
    revision=model_info("Ultralytics/YOLO26").sha
    path=hf_hub_download("Ultralytics/YOLO26","yolo26n-cls.pt",revision=revision)
    write_json(RUN/"classifier-pretrained.json",{"source":"https://huggingface.co/Ultralytics/YOLO26","revision":revision,"sha256":sha(path),"epochs":epochs})
    model=YOLO(path)
    model.train(data=str(DATA),epochs=epochs,imgsz=224,batch=32,device="mps" if torch.backends.mps.is_available() else "cpu",workers=0,cache=False,project=str(RUN),name=MODEL_RUN,seed=CONFIG["seed"],patience=7,amp=False,plots=True,verbose=False)
    print("Category-only photo training completed",flush=True)


def evaluate():
    import torch
    from ultralytics import YOLO
    weights=RUN/MODEL_RUN/"weights/best.pt"
    if not weights.exists():raise ValueError("No completed classifier checkpoint")
    result=YOLO(str(weights)).val(data=str(DATA),split="test",imgsz=224,batch=16,device="mps" if torch.backends.mps.is_available() else "cpu",workers=0,project=str(RUN),name="waste-groups-heldout",plots=True,verbose=False)
    write_json(RUN/MODEL_RUN/"heldout-summary.json",{"evaluatedAt":now(),"weightsSha256":sha(weights),"metrics":{k:float(v) for k,v in result.results_dict.items()},"materialVerified":False,"torontoSortingAccuracy":False,"labelOrigin":"Source categories transferred to auxiliary groups; no independent composition verification","runtimeEnabled":False})
    print(result.results_dict,flush=True)


def export_model():
    import onnx
    import onnxruntime as ort
    import numpy as np
    from ultralytics import YOLO
    weights=RUN/MODEL_RUN/"weights/best.pt";model=YOLO(str(weights))
    file=Path(model.export(format="onnx",imgsz=224,opset=17,dynamic=False,simplify=False,device="cpu",half=False))
    onnx.checker.check_model(onnx.load(file));session=ort.InferenceSession(str(file),providers=["CPUExecutionProvider"])
    output=session.run(None,{session.get_inputs()[0].name:np.zeros((1,3,224,224),dtype=np.float32)})[0]
    if output.shape!=(1,6) or not np.isfinite(output).all():raise ValueError("Invalid exported classifier")
    write_json(file.with_suffix(".json"),{"model":MODEL_RUN,"sha256":sha(file),"classes":[model.names[i] for i in range(len(model.names))],"input":session.get_inputs()[0].name,"output":session.get_outputs()[0].name,"size":224,"preprocessing":"Ultralytics classify_transforms: RGB, resize shortest side to224, center crop224, scale0..1, mean0 std1","materialVerified":False,"torontoSortingAccuracy":False,"runtimeEnabled":False})
    print("Exported classifier:",file,flush=True)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest="command",required=True);s.add_parser("prepare");t=s.add_parser("train");t.add_argument("--epochs",type=int,default=20);s.add_parser("evaluate");s.add_parser("export-model");a=p.parse_args()
    if a.command=="prepare":prepare()
    elif a.command=="train":train(a.epochs)
    elif a.command=="evaluate":evaluate()
    else:export_model()
