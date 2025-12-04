import os
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def fetch_json(url: str) -> dict:
    """Fetch JSON from a URL with basic no-cache headers."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "build_5m_deltas/1.0",
            "Cache-Control": "no-store",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} from {url}")
        return json.loads(resp.read().decode("utf-8"))


def build_pills(live: dict) -> dict:
    """
    Build pills.json structure from /live/intraday payload.

    Expected output shape:

    {
      "stamp5": "...",
      "stamp10": "...",
      "sectors": {
        "sector name": { "d5m": number, "d10m": number }
      }
    }

    For now we will just fill d5m/d10m with 0.0 so the structure is correct.
    You and your teammate can plug in real delta math later.
    """

    # Use updated_at_utc or updated_at as our timestamps
    ts = (
        live.get("updated_at_utc")
        or live.get("updated_at")
        or datetime.now(timezone.utc).isoformat()
    )

    sectors_out = {}

    cards = live.get("sectorCards") or []
    for c in cards:
        name = str(c.get("sector") or "Unknown")
        # Placeholder deltas — structure only
        sectors_out[name] = {
            "d5m": 0.0,
            "d10m": 0.0,
        }

    return {
        "stamp5": ts,
        "stamp10": ts,
        "sectors": sectors_out,
    }


def main():
    live_url = os.environ.get("LIVE_URL")
    if not live_url:
        raise RuntimeError("LIVE_URL environment variable is not set")

    print(f"[build_5m_deltas] Fetching live intraday from {live_url!r}")
    live = fetch_json(live_url)

    pills = build_pills(live)

    out_path = Path("data") / "pills.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(pills, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[build_5m_deltas] Wrote {out_path} with {len(pills.get('sectors', {}))} sectors.")


if __name__ == "__main__":
    main()
