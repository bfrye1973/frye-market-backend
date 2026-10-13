#!/usr/bin/env python3
"""Build and maintain immutable Engine 25 10-minute market-internals archives."""

from __future__ import annotations

import argparse
import json
import math
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PHOENIX = ZoneInfo("America/Phoenix")
SCHEMA = "engine25.marketInternals10mArchive@1"


def finite_number(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def classify_sector(card):
    breadth = finite_number(card.get("breadth_pct"))
    momentum = finite_number(card.get("momentum_pct"))
    if breadth is None or momentum is None:
        return "UNAVAILABLE"
    if breadth >= 55 and momentum >= 55:
        return "STRONG"
    if breadth <= 45 and momentum <= 45:
        return "WEAK"
    return "NEUTRAL"


def canonical_timestamp(payload):
    value = (
        payload.get("updated_at_utc")
        or (payload.get("meta") or {}).get("last_full_run_utc")
        or payload.get("generated_at_utc")
    )
    if not value:
        raise ValueError("canonical source timestamp missing")
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"invalid canonical source timestamp: {value}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def sum_field(cards, field):
    values = [finite_number(card.get(field)) for card in cards if isinstance(card, dict)]
    values = [value for value in values if value is not None]
    return sum(values) if values else None


def build_record(payload, live_branch="data-live-10min", archived_at=None):
    cards = payload.get("sectorCards")
    if not isinstance(cards, list):
        raise ValueError("sectorCards missing")

    source_dt = canonical_timestamp(payload)
    source_timestamp = source_dt.isoformat().replace("+00:00", "Z")
    archive_time = archived_at or datetime.now(timezone.utc)

    archived_cards = []
    counts = {"STRONG": 0, "NEUTRAL": 0, "WEAK": 0}
    classified = 0

    for card in cards:
        if not isinstance(card, dict):
            continue
        state = classify_sector(card)
        if state in counts:
            counts[state] += 1
            classified += 1
        archived_cards.append(
            {
                "sector": card.get("sector"),
                "state": state,
                "up": finite_number(card.get("up")),
                "down": finite_number(card.get("down")),
                "nh": finite_number(card.get("nh")),
                "nl": finite_number(card.get("nl")),
                "breadth_pct": finite_number(card.get("breadth_pct")),
                "momentum_pct": finite_number(card.get("momentum_pct")),
                "advancingVolume": finite_number(card.get("advancingVolume")),
                "decliningVolume": finite_number(card.get("decliningVolume")),
                "unchangedVolume": finite_number(card.get("unchangedVolume")),
                "stocksScanned": finite_number(card.get("stocksScanned")),
                "stocksWithVolume": finite_number(card.get("stocksWithVolume")),
            }
        )

    advancing = sum_field(cards, "up")
    declining = sum_field(cards, "down")
    breadth_denominator = (advancing or 0) + (declining or 0)

    new_highs = sum_field(cards, "nh")
    new_lows = sum_field(cards, "nl")

    advancing_volume = sum_field(cards, "advancingVolume")
    declining_volume = sum_field(cards, "decliningVolume")
    unchanged_volume = sum_field(cards, "unchangedVolume")
    directional_volume = (advancing_volume or 0) + (declining_volume or 0)

    stocks_scanned = sum_field(cards, "stocksScanned")
    stocks_with_volume = sum_field(cards, "stocksWithVolume")

    complete = (
        len(cards) == 11
        and classified == 11
        and advancing is not None
        and declining is not None
        and new_highs is not None
        and new_lows is not None
        and advancing_volume is not None
        and declining_volume is not None
        and stocks_scanned is not None
        and stocks_with_volume is not None
    )

    return {
        "schema": SCHEMA,
        "timeframe": "10m",
        "sourceTimestamp": source_timestamp,
        "generatedAt": payload.get("updated_at_utc") or payload.get("updated_at") or source_timestamp,
        "archivedAt": archive_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "freshnessState": "FRESH_AT_SOURCE" if complete else "INCOMPLETE_AT_SOURCE",
        "completeCanonicalSet": complete,
        "stocksScanned": stocks_scanned,
        "stocksWithVolume": stocks_with_volume,
        "coveragePct": (
            stocks_with_volume / stocks_scanned * 100
            if stocks_scanned and stocks_with_volume is not None
            else None
        ),
        "advancingStocks": advancing,
        "decliningStocks": declining,
        "advancingBreadthPct": advancing / breadth_denominator * 100 if breadth_denominator else None,
        "decliningBreadthPct": declining / breadth_denominator * 100 if breadth_denominator else None,
        "strongSectorCount": counts["STRONG"],
        "neutralSectorCount": counts["NEUTRAL"],
        "weakSectorCount": counts["WEAK"],
        "newHighs": new_highs,
        "newLows": new_lows,
        "netNewHighsLows": (
            new_highs - new_lows if new_highs is not None and new_lows is not None else None
        ),
        "advancingVolume": advancing_volume,
        "decliningVolume": declining_volume,
        "unchangedVolume": unchanged_volume,
        "advancingVolumeShare": (
            advancing_volume / directional_volume * 100 if directional_volume else None
        ),
        "decliningVolumeShare": (
            declining_volume / directional_volume * 100 if directional_volume else None
        ),
        "volumeImbalance": (
            (advancing_volume - declining_volume) / directional_volume * 100
            if directional_volume
            else None
        ),
        "sectorCards": archived_cards,
        "source": {
            "branch": live_branch,
            "file": "data/outlook_intraday.json",
        },
    }


def archive_relative_path(record, root="data/engine25-10m-history"):
    dt = datetime.fromisoformat(record["sourceTimestamp"].replace("Z", "+00:00"))
    phoenix = dt.astimezone(PHOENIX)
    return Path(root) / phoenix.strftime("%Y-%m-%d") / phoenix.strftime("%H%M%S")


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
    build.add_argument("--history-root", default="data/engine25-10m-history")
    build.add_argument("--live-branch", default="data-live-10min")

    prune = sub.add_parser("prune")
    prune.add_argument("--history-root", default="data/engine25-10m-history")
    prune.add_argument("--retention-days", type=int, default=30)

    args = parser.parse_args()

    if args.command == "build":
        source_path = Path(args.input)
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        record = build_record(payload, live_branch=args.live_branch)
        relative = archive_relative_path(record, args.history_root)

        stage = Path(args.stage_dir)
        stage.mkdir(parents=True, exist_ok=True)
        (stage / "engine25_10m_snapshot.json").write_text(
            json.dumps(record, indent=2) + "\n", encoding="utf-8"
        )
        (stage / "outlook_intraday.json").write_text(
            json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        print(json.dumps({
            "archive_rel": str(relative),
            "source_ts": record["sourceTimestamp"],
            "complete": record["completeCanonicalSet"],
            "sector_count": len(record["sectorCards"]),
        }))
        return

    removed = enforce_retention(args.history_root, args.retention_days)
    print(json.dumps({"removed": removed}))


if __name__ == "__main__":
    main()
