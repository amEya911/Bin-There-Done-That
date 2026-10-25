"""Publish local model proposals and explicit Codex reviews into the local annotation workspace."""
import argparse
import importlib.util
import json
from pathlib import Path
from waste_data.core import ROOT,CONFIG,REVIEW_SENTINEL,CLASSES,read_jsonl,write_json,now

spec=importlib.util.spec_from_file_location("annotation_workspace",ROOT/"scripts/annotation-workspace.py")
workspace=importlib.util.module_from_spec(spec);spec.loader.exec_module(workspace)
HOME=ROOT/CONFIG["dataRoot"]
VERSION="Florence-2 local suggestions — not reviewed"


def task_list(project=2):
    rows=[];page=1
    while True:
        data=workspace.api(f"/api/tasks?project={project}&page_size=250&page={page}&fields=all")
        batch=data["tasks"];rows.extend(batch)
        if len(rows)==data["total"]:return rows
        if not batch or len(rows)>data["total"]:raise ValueError("Incomplete or changing task list")
        page+=1


def rectangle(box,image,identity):
    w,h=image["width"],image["height"];x,y,bw,bh=box["bbox"]
    left,top=max(0,x),max(0,y);right,bottom=min(w,x+bw),min(h,y+bh)
    if right<=left or bottom<=top:raise ValueError("Invalid proposed box")
    label=box.get("label") if box.get("label") in CLASSES else REVIEW_SENTINEL
    return {"id":identity,"from_name":"objects","to_name":"image","type":"rectanglelabels","original_width":w,"original_height":h,"image_rotation":0,"value":{"x":left/w*100,"y":top/h*100,"width":(right-left)/w*100,"height":(bottom-top)/h*100,"rotation":0,"rectanglelabels":[label]}}


def sync(proposals=True,reviews=True):
    records={r["id"]:r for r in read_jsonl(HOME/"manifest.jsonl")}
    model={r["id"]:r for r in read_jsonl(HOME/"auto-labels/florence-proposals.jsonl")}
    counts={"newProposals":0,"newReviews":0,"existingAnnotationsPreserved":0}
    for index,task in enumerate(task_list(),1):
        identity=task["data"].get("dataset_id");record=records.get(identity)
        if not record:continue
        prediction=model.get(identity)
        if proposals and prediction and prediction["state"]!="error" and not any(p.get("model_version")==VERSION for p in task.get("predictions",[])):
            result=[rectangle(b,record["image"],f"local-{i}") for i,b in enumerate(prediction["boxes"])]
            workspace.api("/api/predictions/",{"task":task["id"],"model_version":VERSION,"result":result})
            counts["newProposals"]+=1
        if reviews and record["review"]["state"]=="accepted":
            if task.get("annotations"):
                counts["existingAnnotationsPreserved"]+=1
            else:
                result=[]
                def choice(name,values,region=None):
                    item={"from_name":name,"to_name":"image","type":"choices","value":{"choices":values}}
                    if region:item["id"]=region
                    result.append(item)
                for i,b in enumerate(record["boxes"]):
                    region=f"review-{i}";result.append(rectangle(b,record["image"],region))
                    choice("material",["unknown"],region);choice("material_basis",["unknown"],region);choice("visibility",[b["visibility"]],region)
                choice("review_status",["complete"]);choice("domain",[record["domain"]])
                checks=["all_visible_targets_reviewed","source_rights_checked","related_image_groups_checked"]
                if record["review"].get("confirmedNegative"):checks.append("confirmed_no_targets")
                choice("checks",checks)
                result.append({"from_name":"review_notes","to_name":"image","type":"textarea","value":{"text":["Codex single AI visual review; no independent human verification. "+record["review"]["notes"]]}})
                workspace.api(f"/api/tasks/{task['id']}/annotations/",{"result":result,"ground_truth":False,"lead_time":0})
                counts["newReviews"]+=1
        if index%250==0:print("Workspace tasks checked:",index,counts,flush=True)
    write_json(HOME/"auto-labels/workspace-sync.json",{"at":now(),**counts})
    print("Workspace sync complete:",counts,flush=True)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--reviews-only",action="store_true");a=p.parse_args();sync(proposals=not a.reviews_only)
