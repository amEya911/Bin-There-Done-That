"""Prepare/review/export local waste training data. Never touches app/Supabase data."""
import argparse
import json
from pathlib import Path
from waste_data.core import CONFIG, ROOT, coverage, initialize, issues, read_jsonl, reserve_evaluation, split_records, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT / CONFIG["dataRoot"])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    seed = sub.add_parser("seed-taco"); seed.add_argument("--limit", type=int, default=120)
    sub.add_parser("seed-bins"); sub.add_parser("condition-crops")
    trashnet = sub.add_parser("seed-trashnet"); trashnet.add_argument("--limit", type=int, default=2444)
    sub.add_parser("validate"); sub.add_parser("split"); sub.add_parser("report")
    sub.add_parser("labelstudio")
    pilot = sub.add_parser("compare-pilot"); pilot.add_argument("first", type=Path); pilot.add_argument("second", type=Path)
    imported = sub.add_parser("import-labelstudio"); imported.add_argument("file", type=Path)
    exported = sub.add_parser("export"); exported.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); home = initialize(args.root)
    reserve_evaluation(home)
    if args.command == "init": print(home); return
    if args.command == "seed-taco":
        if not 1 <= args.limit <= 1500: raise ValueError("limit must be between1 and1500")
        from waste_data.taco import seed
        seed(home, args.limit)
    if args.command == "seed-bins":
        from waste_data.openimages import seed
        seed(home)
    if args.command == "seed-trashnet":
        from waste_data.trashnet import seed
        seed(home, args.limit)
    if args.command == "condition-crops":
        from waste_data.openimages import make_condition_crops
        make_condition_crops(home)
    records = read_jsonl(home / "manifest.jsonl")
    conditions = read_jsonl(home / "conditions.jsonl")
    if args.command == "validate":
        invalid = {r["id"]: e for r in records if (e := issues(r, home))}
        write_json(home / "validation.json", {"images": len(records), "invalid": invalid})
        print(json.dumps({"images": len(records), "invalid": invalid}, indent=2))
        if invalid: raise SystemExit(1)
    if args.command == "split":
        file = home / "splits.json"; previous = json.loads(file.read_text()) if file.exists() else {}
        ledger = split_records(records, previous); write_json(file, ledger)
        print("Frozen split assignments:", len(ledger))
    if args.command == "report":
        file = home / "splits.json"; ledger = json.loads(file.read_text()) if file.exists() else {}
        data = coverage(records, conditions, ledger); write_json(home / "coverage.json", data)
        print(json.dumps({k: v for k, v in data.items() if k != "classes"}, indent=2))
        print("Classes with proposed images:", sum(r["proposedImages"] > 0 for r in data["classes"]), "/40")
    if args.command == "labelstudio":
        from waste_data.labelstudio import prepare
        prepare(home, records, conditions)
    if args.command == "import-labelstudio":
        from waste_data.labelstudio import import_reviews
        import_reviews(home, args.file)
    if args.command == "compare-pilot":
        from waste_data.pilot import compare
        compare(args.first, args.second, home / "reviews/pilot-comparison.json")
    if args.command == "export":
        from waste_data.export import export_dataset
        export_dataset(home, args.output)


if __name__ == "__main__":
    main()
