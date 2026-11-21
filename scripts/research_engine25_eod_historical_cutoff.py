#!/usr/bin/env python3
"""Research-only reconstructed EOD as of the 2026-10-28 completed session.

Fetch one *historical grouped daily stocks* response per completed session,
not one REST request per symbol (the original job timed out after 30 minutes
and silently turned provider errors into zero signal). All results are
retrospective; never label them as originally published on October 28.
"""
import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

UTC = timezone.utc
KEY = (os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or "").strip()
BASE = "https://api.polygon.io"
CUTOFF = os.environ.get("EOD_RESEARCH_SESSION", "2026-10-28")
SECTORS_DIR = os.environ.get("EOD_RESEARCH_SECTORS_DIR", "data/sectors")
OUT = os.environ.get("EOD_RESEARCH_OUT", "/tmp/eod-shadow-2026-10-28.json")
MAX_WORKERS = max(1, min(6, int(os.environ.get("EOD_RESEARCH_WORKERS", "4"))))
LOOKBACK_DAYS = 45
MIN_HISTORY = 22
MIN_COVERAGE = float(os.environ.get("EOD_RESEARCH_MIN_COVERAGE", "80"))


def request_day(day):
    """Only expected market-holiday empty responses may be ignored."""
    query = urllib.parse.urlencode({"adjusted": "true", "include_otc": "false", "apiKey": KEY})
    url = BASE + "/v2/aggs/grouped/locale/us/market/stocks/" + day + "?" + query
    req = urllib.request.Request(url, headers={"User-Agent": "engine25-eod-no-lookahead-research"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=55) as response:
                data = json.loads(response.read().decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("results", []), list):
                raise ValueError("GROUPED_RESPONSE_INVALID " + day)
            if data.get("status") in ("ERROR", "NOT_AUTHORIZED"):
                raise RuntimeError("GROUPED_API_REJECTED " + day + " " + str(data.get("status")))
            return day, data.get("results", [])
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError("GROUPED_API_HTTP_" + str(exc.code) + " " + day) from exc
            time.sleep(2 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 3:
                raise RuntimeError("GROUPED_API_NETWORK_ERROR " + day) from exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("GROUPED_API_RETRIES_EXHAUSTED " + day)


def read_symbols(path):
    with open(path, newline="", encoding="utf-8-sig") as file:
        rows = csv.DictReader(file)
        return sorted({(row.get("Symbol") or row.get("symbol") or "").strip().upper()
                       for row in rows if row.get("Symbol") or row.get("symbol")})


def discover():
    sectors = {}
    for p in sorted(Path(SECTORS_DIR).glob("*.csv")):
        symbols = [x for x in read_symbols(p) if x]
        if symbols:
            sectors[p.stem] = symbols
    return sectors


def flags(bars):
    # Preserve the existing EOD high/low and +/-3x ADR20 formulas exactly.
    if len(bars) < MIN_HISTORY:
        return None
    idx = len(bars) - 1
    nh = nl = 0
    for event_idx in range(idx - 1, idx + 1):
        prior = bars[event_idx - 10:event_idx]
        cur = bars[event_idx]
        if cur["h"] > max(x["h"] for x in prior):
            nh = 1
        if cur["l"] < min(x["l"] for x in prior):
            nl = 1
    move = bars[idx]["c"] - bars[idx - 4]["c"]
    sample = bars[idx - 19:idx + 1]
    adr20 = sum(x["h"] - x["l"] for x in sample) / len(sample)
    up = int(adr20 > 0 and move >= 3.0 * adr20)
    dn = int(adr20 > 0 and move <= -3.0 * adr20)
    return nh, nl, up, dn


def pct(a, b):
    return 100 * a / (a + b) if a + b else 50.0


def main():
    if not KEY or KEY.startswith("\\") or len(KEY) < 12:
        raise SystemExit("POLYGON_API_KEY_MISSING_OR_MALFORMED — no historical EOD score can be produced")
    session = date.fromisoformat(CUTOFF)
    if session >= datetime.now(UTC).date():
        raise SystemExit("EOD_RESEARCH_SESSION_MUST_BE_COMPLETED")
    sectors = discover()
    if not sectors:
        raise SystemExit("EOD_SECTOR_UNIVERSE_MISSING")
    symbols = set(x for rows in sectors.values() for x in rows)
    days = [(session - timedelta(days=i)).isoformat()
            for i in range(LOOKBACK_DAYS + 1)
            if (session - timedelta(days=i)).weekday() < 5]
    if len(days) < MIN_HISTORY:
        raise SystemExit("INSUFFICIENT_CALENDAR_LOOKBACK")

    by_symbol = defaultdict(list)
    closed = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(request_day, day) for day in days]
        for future in as_completed(futures):
            day, rows = future.result()  # Error is fatal; never replace with zeroes.
            if not rows:
                closed.append(day)  # A holiday/no-trading day.
                continue
            seen = set()
            usable = 0
            for row in rows:
                symbol = str(row.get("T") or "").strip().upper()
                if symbol not in symbols or symbol in seen:
                    continue
                try:
                    hi, lo, close = float(row["h"]), float(row["l"]), float(row["c"])
                    if not (hi >= lo > 0 and close > 0):
                        continue
                except (KeyError, TypeError, ValueError):
                    continue
                by_symbol[symbol].append({"d": day, "h": hi, "l": lo, "c": close})
                seen.add(symbol)
                usable += 1
            print("[grouped] " + day + " matching=" + str(usable), flush=True)

    valid_sessions = sorted(set(x["d"] for bars in by_symbol.values() for x in bars))
    if CUTOFF not in valid_sessions or len(valid_sessions) < MIN_HISTORY:
        raise SystemExit("EOD_REQUIRED_COMPLETED_SESSIONS_UNAVAILABLE")
    for bars in by_symbol.values():
        bars.sort(key=lambda x: x["d"])

    symbol_flags = {}
    missing = []
    for symbol in sorted(symbols):
        bars = by_symbol.get(symbol, [])
        if len(bars) < MIN_HISTORY or not bars or bars[-1]["d"] != CUTOFF:
            missing.append(symbol)
            continue
        result = flags(bars)
        if result is None:
            missing.append(symbol)
            continue
        symbol_flags[symbol] = result

    coverage = 100 * len(symbol_flags) / max(1, len(symbols))
    if coverage < MIN_COVERAGE:
        raise SystemExit(
            "EOD_HISTORY_COVERAGE_INSUFFICIENT " +
            str(len(symbol_flags)) + "/" + str(len(symbols)) +
            " (" + str(round(coverage, 2)) + "%); refusing synthetic neutral stock scores")

    cards = []
    for sector, members in sorted(sectors.items()):
        rows = [symbol_flags[s] for s in members if s in symbol_flags]
        if not rows:
            raise SystemExit("EOD_SECTOR_NO_VERIFIABLE_HISTORY " + sector)
        nh, nl, up, down = [sum(x[i] for x in rows) for i in range(4)]
        cards.append({
            "sector": sector, "nh": nh, "nl": nl, "up": up, "down": down,
            "breadth_pct": round(pct(nh, nl), 2),
            "momentum_pct": round(pct(up, down), 2),
            "members": len(members), "membersWithHistory": len(rows),
            "coveragePct": round(100 * len(rows) / len(members), 2),
        })
        print("[" + sector + "] nh=" + str(nh) + " nl=" + str(nl) +
              " up=" + str(up) + " down=" + str(down) +
              " covered=" + str(len(rows)) + "/" + str(len(members)), flush=True)

    avg_b = sum(c["breadth_pct"] for c in cards) / len(cards)
    avg_m = sum(c["momentum_pct"] for c in cards) / len(cards)
    score = max(10, min(100, (avg_b + avg_m) / 2))
    state = ("CONSTRUCTIVE" if score >= 65 else "CONSTRUCTIVE_MIXED" if score >= 55
             else "MIXED" if score >= 45 else "WEAK" if score >= 35 else "BEARISH")
    source_ts = CUTOFF + "T20:00:00.000Z"  # 4:00pm EDT on Oct 28, NOT publication time.
    out = {
        "ok": True, "engine": "engine25.reconstructedEod.v1",
        "mode": "RETROSPECTIVE_RECONSTRUCTION",
        "updated_at_utc": source_ts,
        "reconstructedAtUtc": datetime.now(UTC).isoformat(),
        "completedSessionDate": CUTOFF,
        "score": round(score, 1), "state": state,
        "breadthScore": round(avg_b, 1), "momentumScore": round(avg_m, 1),
        "sectorCards": cards, "productionAuthority": False,
        "stocksInUniverse": len(symbols),
        "stocksWithVerifiedHistory": len(symbol_flags),
        "symbolCoveragePct": round(coverage, 2),
        "unavailableSymbolCount": len(missing),
        "coverageMinimumPct": MIN_COVERAGE,
        "completedSessionsFetched": len(valid_sessions),
        "marketClosedDates": sorted(closed),
        "provenance": {
            "kind": "RETROSPECTIVE_RECONSTRUCTION",
            "originallyPublished": False, "reconstructed": True,
            "formulaVersion": "engine25.reconstructedEod.v1",
            "completedSessionDate": CUTOFF,
            "historicalSource": "polygon_grouped_daily_adjusted",
            "originalPublicationVerified": False,
            "universeMayContainSurvivorshipBias": True,
        },
        "formula": {
            "breadth": "10-session HIGH/LOW event with 2-session carry",
            "momentum": "4-session close move vs +/-3x ADR20",
            "adr": "20-session average daily HIGH-LOW, current completed day included",
        },
    }
    Path(OUT).write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({k: out[k] for k in (
        "completedSessionDate", "score", "state", "breadthScore",
        "momentumScore", "stocksInUniverse", "stocksWithVerifiedHistory",
        "symbolCoveragePct", "completedSessionsFetched")}, indent=2))


if __name__ == "__main__":
    main()
