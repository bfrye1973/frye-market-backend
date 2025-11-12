# algos/index-sectors/10m/formulas.py
import json, os, math, urllib.request
from datetime import datetime, timezone

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
OUT_PATH = os.path.join(os.path.dirname(__file__), "outlook_sector_10m.json")
FEED_URL = "https://frye-market-backend-1.onrender.com/live/intraday?t={}".format(int(datetime.now().timestamp()))

def http_json(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read().decode("utf-8"))

def safe_eval(expr, **vals):
    try:
        return float(eval(expr, {"__builtins__": {}}, vals))
    except Exception:
        return (vals.get("breadth", 0) + vals.get("momentum", 0)) / 2

def parse_rule(rule, b, m):
    parts = [p.strip() for p in rule.split("&&")]
    ok = True
    for p in parts:
        if ">=" in p:
            left, thr = p.split(">="); thr = float(thr)
            if left.strip() == "breadth" and not (b >= thr): ok = False
            if left.strip() == "momentum" and not (m >= thr): ok = False
        elif "<=" in p:
            left, thr = p.split("<="); thr = float(thr)
            if left.strip() == "breadth" and not (b <= thr): ok = False
            if left.strip() == "momentum" and not (m <= thr): ok = False
    return ok

def grade_token(v, gcfg):
    ok = float(gcfg["ok"].replace(">=", "")) if ">=" in gcfg["ok"] else 60
    warn = float(gcfg["warn"].replace(">=", "")) if ">=" in gcfg["warn"] else 50
    if v >= ok: return "ok"
    if v >= warn: return "warn"
    return "danger"

def main():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    feed = http_json(FEED_URL)
    cards = feed.get("sectorCards", [])
    if not isinstance(cards, list) or len(cards) != 11:
        print("⚠️ invalid sectorCards feed"); return

    rules = cfg["rules"]
    gcfg = rules["grade"]["default"]
    out = []

    for c in cards:
        b = float(c.get("breadth_pct", 0))
        m = float(c.get("momentum_pct", 0))
        tilt = round(safe_eval(rules["tilt"], breadth=b, momentum=m), 2)
        up_rule = rules["outlook"]["bullish"]
        down_rule = rules["outlook"]["bearish"]
        outlook = "neutral"
        if parse_rule(up_rule, b, m): outlook = "bullish"
        elif parse_rule(down_rule, b, m): outlook = "bearish"
        grade = grade_token(tilt, gcfg)
        out.append({
            "sector": c.get("sector"),
            "breadth": b,
            "momentum": m,
            "tilt": tilt,
            "outlook": outlook,
            "grade": grade
        })

    from zoneinfo import ZoneInfo
    PHX = ZoneInfo("America/Phoenix")

 # …
 result = {
     "version": cfg["version"],
     # use feed’s timestamps if present; otherwise compute (AZ + UTC)
     "updated_at":     feed.get("updated_at") or datetime.now(PHX).strftime("%Y-%m-%d %H:%M:%S"),
     "updated_at_utc": feed.get("updated_at_utc") or datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),
     "sectors": out
 }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"✅ wrote {OUT_PATH}")

if __name__ == "__main__":
    main()
