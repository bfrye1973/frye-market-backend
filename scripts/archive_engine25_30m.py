#!/usr/bin/env python3
"""Archive helper for Engine25 full-market 30m internals."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

PHOENIX = ZoneInfo("America/Phoenix")
SCHEMA = "engine25.marketInternals30mArchive@1"


def parse_source_timestamp(payload):
    value = payload.get("sourceTimestamp")
    if not value:
        raise ValueError("sourceTimestamp missing")
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def archive_relative_path(payload, root="data/engine25-30m-history"):
    dt = parse_source_timestamp(payload).astimezone(PHOENIX)
    return Path(root) / dt.strftime("%Y-%m-%d") / dt.strftime("%H%M%S")


def build_archive_record(payload, archived_at=None):
    record = dict(payload)
    record["schema"] = SCHEMA
    record["archivedAt"] = (
        archived_at or datetime.now().astimezone()
    ).astimezone(ZoneInfo("UTC")).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return record


def enforce_retention(root, retention_days, today=None):
    root = Path(root)
    if not root.exists():
        return []
    today = today or datetime.now(PHOENIX).date()
    cutoff = today - timedelta(days=retention_days)
    removed = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        try:
            day = datetime.strptime(child.name, "%Y-%m-%d").date()
        except ValueError:
            continue
        if day < cutoff:
            shutil.rmtree(child)
            removed.append(child.name)
    return removed


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build")
    build.add_argument("--input", required=True)
    build.add_argument("--stage-dir", required=True)
    build.add_argument("--history-root", default="data/engine25-30m-history")

    prune = sub.add_parser("prune")
    prune.add_argument("--history-root", default="data/engine25-30m-history")
    prune.add_argument("--retention-days", type=int, default=30)

    args = parser.parse_args()

    if args.command == "build":
        source = Path(args.input)
        payload = json.loads(source.read_text(encoding="utf-8"))

        if payload.get("schema") != "engine25.marketInternals30m@1":
            raise SystemExit("archive rejected: wrong source schema")
        if payload.get("timeframe") != "30m":
            raise SystemExit("archive rejected: wrong timeframe")
        if not isinstance(payload.get("sectorCards"), list) or len(payload["sectorCards"]) != 11:
            raise SystemExit("archive rejected: canonical 11-sector set missing")

        record = build_archive_record(payload)
        rel = archive_relative_path(payload, args.history_root)

        stage = Path(args.stage_dir)
        stage.mkdir(parents=True, exist_ok=True)
        (stage / "engine25_30m_snapshot.json").write_text(
            json.dumps(record, indent=2) + "\n", encoding="utf-8"
        )
        (stage / "outlook_30m_internals.json").write_text(
            json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8"
        )

        print(json.dumps({
            "archive_rel": str(rel),
            "source_ts": payload["sourceTimestamp"],
            "complete": payload.get("completeCanonicalSet"),
            "sector_count": len(payload["sectorCards"]),
        }))
        return

    removed = enforce_retention(args.history_root, args.retention_days)
    print(json.dumps({"removed": removed}))


if __name__ == "__main__":
    main()
