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


def task_ids(project_id):
    """Read every task page before importing, so large queues remain idempotent."""
    seen = set(); identities = set(); page = 1; expected = None
    while True:
        data = api(f"/api/tasks?project={project_id}&page_size=250&page={page}")
        rows = data.get("tasks", data.get("results", [])) if isinstance(data, dict) else data
        total = data.get("total", len(rows)) if isinstance(data, dict) else len(rows)
        if expected is None: expected = total
        if total != expected: raise RuntimeError("Task list changed during pagination; retry sync")
        for task in rows:
            if task["id"] in seen: raise RuntimeError("Task pagination repeated an entry; refusing duplicate import")
            seen.add(task["id"])
            identity = task.get("data", {}).get("dataset_id")
            if identity:
                if identity in identities: raise RuntimeError("Existing annotation queue contains duplicate dataset IDs")
                identities.add(identity)
        if len(seen) == expected: return identities
        if not rows or len(seen) > expected: raise RuntimeError("Incomplete task pagination; refusing duplicate import")
        page += 1


def image_storage(project_id, folder):
    """Authorize only the image directory, without generating duplicate file tasks."""
    path = str((HOME / folder).resolve())
    data = api(f"/api/storages/localfiles/?project={project_id}")
    stores = data.get("results", []) if isinstance(data, dict) else data
    if not any(str(Path(store["path"]).resolve()) == path for store in stores):
        api("/api/storages/localfiles/", {"project": project_id, "title": "Dataset image files", "path": path, "use_blob_urls": True, "recursive_scan": False, "regex_filter": r".*\.jpg$"})


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
        image_storage(project["id"], "conditions" if config == "conditions.xml" else "images")
        ids = task_ids(project["id"])
        tasks = [t for t in json.loads((directory / task_file).read_text()) if t["data"]["dataset_id"] not in ids]
        for offset in range(0, len(tasks), 250):
            api(f"/api/projects/{project['id']}/import", tasks[offset:offset + 250])
        saved.append({"title": title, "id": project["id"], "url": BASE + f"/projects/{project['id']}/data", "newTasks": len(tasks)})
        print(title, "new tasks:", len(tasks), flush=True)
    write_json(directory / "workspace.json", saved)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("command", choices=["start", "sync"])
    args = parser.parse_args()
    start() if args.command == "start" else sync()
