#!/usr/bin/env python3
import json, sys

def clamp(x, lo, hi): return max(lo, min(hi, x))

def main():
    if len(sys.argv) < 3:
        print("usage: finalize_intraday_breadth.py --in IN --out OUT", file=sys.stderr)
        sys.exit(2)
    args = sys.argv[1:]
    p_in  = args[args.index("--in")+1]
    p_out = args[args.index("--out")+1]

    with open(p_in, "r", encoding="utf-8") as f:
        j = json.load(f)

    m = j.get("metrics", {}) or {}

    # components (prefer smoothed fast, then raw)
    a_fast = m.get("breadth_align_pct_fast")
    b_fast = m.get("breadth_bar_pct_fast")
    a_raw  = m.get("breadth_align_pct")
    b_raw  = m.get("breadth_bar_pct")

    a_val = a_fast if isinstance(a_fast,(int,float)) else (a_raw if isinstance(a_raw,(int,float)) else None)
    b_val = b_fast if isinstance(b_fast,(int,float)) else (b_raw if isinstance(b_raw,(int,float)) else None)

    # If both missing, keep existing breadth_pct (or slow). Otherwise compute 60/40.
    if a_val is None and b_val is None:
        pass  # leave metrics.breadth_pct as-is (fallback already applied upstream)
    else:
        if a_val is None: a_val = 0.0
        if b_val is None: b_val = 0.0
        breadth_final = round(clamp(0.60*float(a_val) + 0.40*float(b_val), 0.0, 100.0), 2)
        m["breadth_pct"] = breadth_final

    # keep components visible for QA
    j["metrics"] = m
    with open(p_out, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, separators=(",",":"))

if __name__ == "__main__":
    main()
