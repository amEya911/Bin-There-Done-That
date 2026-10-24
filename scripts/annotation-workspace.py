"""Run the free local Label Studio workspace. Credentials never enter app code."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request
from waste_data.core import CONFIG, ROOT, write_json

HOME = ROOT / CONFIG["dataRoot"]
AUTH = ROOT / ".data/label-studio-login.json"
RUNTIME = ROOT / "output/runtime/label-studio.json"
BASE = "http://127.0.0.1:9090"


def credentials():
    if not AUTH.exists():
        AUTH.write_text(json.dumps({"username": "annotator@binthere.local", "password": secrets.token_urlsafe(24), "token": secrets.token_hex(20)}, indent=2) + "\n")
        AUTH.chmod(0o600)
    return json.loads(AUTH.read_text())


def api(path, data=None):
    auth = credentials()
    request = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None, headers={"Content-Type": "application/json", "Authorization": "Token " + auth["token"]})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(); return json.loads(body) if body else None


def start():
    try:
        api("/api/projects/"); print("Annotation workspace already running:", BASE); return
    except Exception: pass
    auth = credentials(); directory = ROOT / ".data/label-studio"
    directory.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.update({"LABEL_STUDIO_BASE_DATA_DIR": str(directory), "LABEL_STUDIO_USERNAME": auth["username"], "LABEL_STUDIO_PASSWORD": auth["password"], "LABEL_STUDIO_USER_TOKEN": auth["token"], "LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED": "true", "LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT": str(HOME.resolve()), "LABEL_STUDIO_COLLECT_ANALYTICS": "false", "LABEL_STUDIO_DISABLE_SIGNUP_WITHOUT_LINK": "true"})
    log = ROOT / "output/runtime/label-studio.log"
    with log.open("ab") as stream:
        process = subprocess.Popen([str(ROOT / ".data/annotation-tools/bin/label-studio"), "start", "--init", "--no-browser", "--data-dir", str(directory), "--database", str(directory / "annotations.sqlite3"), "--internal-host", "127.0.0.1", "--port", "9090", "--enable-legacy-api-token", "--log-level", "WARNING"], cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
    write_json(RUNTIME, {"pid": process.pid, "url": BASE, "log": str(log)})
    for _ in range(90):
        if process.poll() is not None: raise RuntimeError("Annotation service stopped; see its local log")
        try:
            api("/api/projects/"); print("Local annotation workspace ready:", BASE); print("Private login file:", AUTH); return
        except Exception: time.sleep(.5)
    raise RuntimeError("Annotation service is still starting; inspect local log")


def sync():
    directory = HOME / "label-studio"
    projects = api("/api/projects/")
    existing = projects.get("results", []) if isinstance(projects, dict) else projects
    plans = [("Objects — review source proposals", "objects.xml", "object-tasks.json"), ("Pilot A — independent labels", "objects.xml", "pilot-a-tasks.json"), ("Pilot B — independent labels", "objects.xml", "pilot-b-tasks.json"), ("Bin conditions — inspect each crop", "conditions.xml", "condition-tasks.json")]
    saved = []
    for title, config, task_file in plans:
        project = next((p for p in existing if p["title"] == title), None)
        if project is None:
            project = api("/api/projects/", {"title": title, "label_config": (directory / config).read_text(), "description": "Local dataset preparation. Source annotations are proposals; review every target, rights and related-image grouping. No public app reports or model activation."})
        data = api(f"/api/tasks?project={project['id']}&page_size=1000")
        current = data.get("tasks", data.get("results", [])) if isinstance(data, dict) else data
        if isinstance(data, dict) and data.get("total", len(current)) > len(current): raise RuntimeError("Task pagination requires another page; refusing duplicate import")
        ids = {task.get("data", {}).get("dataset_id") for task in current}
        tasks = [t for t in json.loads((directory / task_file).read_text()) if t["data"]["dataset_id"] not in ids]
        if tasks: api(f"/api/projects/{project['id']}/import", tasks)
        saved.append({"title": title, "id": project["id"], "url": BASE + f"/projects/{project['id']}/data", "newTasks": len(tasks)})
        print(title, "new tasks:", len(tasks), flush=True)
    write_json(directory / "workspace.json", saved)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("command", choices=["start", "sync"])
    args = parser.parse_args()
    start() if args.command == "start" else sync()
