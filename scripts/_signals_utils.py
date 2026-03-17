#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, datetime, urllib.request

def now_iso() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def fetch_json(url: str, timeout: int = 20) -> dict:
    try:
        req = urllib.request.Request(url, headers={"User-Agent":"signals-utils/1.0","Cache-Control":"no-store"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}

def load_json(path: str) -> dict:
    try: return json.load(open(path,"r",encoding="utf-8"))
    except Exception: return {}

def save_json(path: str, obj: dict) -> None:
    json.dump(obj, open(path,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def carry_last_changed(prev_sig: dict, new_state: str, stamp: str):
    """Keep lastChanged unless the state actually flips."""
    prev_state = (prev_sig or {}).get("state")
    last = (prev_sig or {}).get("lastChanged") or stamp
    if prev_state != new_state:
        last = stamp
    return last
