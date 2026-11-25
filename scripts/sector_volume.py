#!/usr/bin/env python3
"""Canonical stock-level sector volume aggregation.

Direction/classification is owned by the calling timeframe producer.
This module only validates volume and reduces classified observations.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable

UP = "UP"
DOWN = "DOWN"
UNCHANGED = "UNCHANGED"

def finite_volume(value: Any):
    if value is None or isinstance(value, bool):
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None

def new_volume_accumulator() -> Dict[str, Any]:
    return {
        "totalVolume": 0.0,
        "advancingVolume": 0.0,
        "decliningVolume": 0.0,
        "unchangedVolume": 0.0,
        "stocksScanned": 0,
        "stocksWithVolume": 0,
    }

def add_volume_observation(acc: Dict[str, Any], classification: str, volume: Any) -> Dict[str, Any]:
    acc["stocksScanned"] += 1
    v = finite_volume(volume)
    if v is None:
        return acc
    acc["stocksWithVolume"] += 1
    acc["totalVolume"] += v
    if classification == UP:
        acc["advancingVolume"] += v
    elif classification == DOWN:
        acc["decliningVolume"] += v
    else:
        acc["unchangedVolume"] += v
    return acc

def finalize_volume_accumulator(acc: Dict[str, Any]) -> Dict[str, Any]:
    total = float(acc["totalVolume"])
    out = dict(acc)
    if total == 0.0:
        out["advancingVolumePct"] = None
        out["decliningVolumePct"] = None
    else:
        out["advancingVolumePct"] = round(100.0 * float(out["advancingVolume"]) / total, 2)
        out["decliningVolumePct"] = round(100.0 * float(out["decliningVolume"]) / total, 2)
    return out

def aggregate_sector_volume(observations: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    acc = new_volume_accumulator()
    for obs in observations:
        add_volume_observation(acc, obs.get("classification", UNCHANGED), obs.get("volume"))
    return finalize_volume_accumulator(acc)
