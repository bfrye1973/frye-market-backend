#!/usr/bin/env python3
"""
Build a replay manifest of yesterday's hourly snapshots.

- Lists files in:
    data/archive/hourly/dashboard/
    data/archive/hourly/source/
  via the GitHub Contents API

- Filters by a given date (default: yesterday, UTC or pass --date YYYY-MM-DD)
- Writes:
    data/archive/hourly/manifest_YYYY-MM-DD.json
  with entries:
    [{ "ts": "2025-09-04T13:45:00Z",
       "dashboard_raw_url": "...",
       "source_raw_url": "..." }, ...]

Env (optional):
  GITHUB_REPO   (default: "bfrye1973/frye-market-backend")
  BRANCH        (default: "main")
  GITHUB_TOKEN  (optional; to raise API rate limit)

Usage:
  python scripts/build_replay_manifest.py
  python scripts/build_replay_manifest.py --date 2025-09-04
"""

import argparse, os, sys, re, json, datetime as dt
from urllib.request import Request, urlopen
from urllib.error import HTTPError

REPO   = os.getenv("GITHUB_REPO", "bfrye1973/frye-market-backend")
BRANCH = os.getenv("BRANCH", "main")
TOKEN  = os.getenv("GITHUB_TOKEN", "").strip()

API_BASE = f"https://api.github.com/repos/{REPO}/contents"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}"

DASH_DIR = "data/archive/hourly/dashboard"
SRC_DIR  = "data/archive/hourly/source"

# outlook_YYYY-MM-DDTHH-MM-SSZ.json
FNAME_RE = re.compile(r"^outlook_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.json$")

def _http_json(url: str):
    headers = {"User-Agent": "ferrari-replay/1.0"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = Request(url, headers=headers)
    with urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))

def list_dir(path: str):
    url = f"{API_BASE}/{path}?ref={BRANCH}"
    try:
        data = _http_json(url)
        if not isinstance(data, list):
            raise RuntimeError(f"Unexpected response: {data}")
        return [item for item in data if item.get("type") == "file"]
    except HTTPError as e:
        print(f"[ERR] list_dir {path} -> {e}", file=sys.stderr)
        return []

def to_iso(ts_from_name: str) -> str:
    # convert YYYY-MM-DDTHH-MM-SSZ -> YYYY-MM-DDTHH:MM:SSZ
    return ts_from_name.replace("-", ":", 2)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD (default: yesterday UTC)")
    args = ap.parse_args()

    if args.date:
        try:
            target_date = dt.datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print("Invalid --date; use YYYY-MM-DD", file=sys.stderr)
            sys.exit(2)
    else:
        target_date = (dt.datetime.utcnow().date() - dt.timedelta(days=1))

    date_str = target_date.strftime("%Y-%m-%d")
    print(f"[info] Building manifest for {date_str}")

    dash_files = list_dir(DASH_DIR)
    src_files  = list_dir(SRC_DIR)

    # Map timestamp -> raw URL for each side
    dash_map = {}
    for f in dash_files:
        m = FNAME_RE.match(f.get("name",""))
        if not m: continue
        ts_name = m.group(1)  # YYYY-MM-DDTHH-MM-SSZ
        if not ts_name.startswith(date_str): continue
        dash_map[ts_name] = f"{RAW_BASE}/{DASH_DIR}/{f['name']}"

    src_map = {}
    for f in src_files:
        m = FNAME_RE.match(f.get("name",""))
        if not m: continue
        ts_name = m.group(1)
        if not ts_name.startswith(date_str): continue
        src_map[ts_name] = f"{RAW_BASE}/{SRC_DIR}/{f['name']}"

    # Join snapshots present in dashboard (primary)
    entries = []
    for ts_name, dash_url in sorted(dash_map.items()):
        src_url = src_map.get(ts_name)
        entries.append({
            "ts": to_iso(ts_name),                   # ISO with colons
            "dashboard_raw_url": dash_url,
            "source_raw_url": src_url
        })

    manifest = {
        "date": date_str,
        "repo": REPO,
        "branch": BRANCH,
        "count": len(entries),
        "hourly": entries
    }

    # Write to repo path
    out_dir = os.path.join("data", "archive", "hourly")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"manifest_{date_str}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"[ok] wrote {out_path} (count={len(entries)})")
    # Also echo sample for quick copy/paste
    if entries:
        print("[sample]", entries[0]["ts"], "->", entries[0]["dashboard_raw_url"])

if __name__ == "__main__":
    main()
