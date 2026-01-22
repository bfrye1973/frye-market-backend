# Index Sectors — 10m Rules (Config-Driven)

**Source feed**: `/live/intraday`  
**Fields used per sector card**: `breadth_pct`, `momentum_pct`, `nh`, `nl`, `up`, `down`

**Derived calculations (formulas.py)**  
- `tilt` = configured `tiltExpr` (default `(breadth + momentum)/2`)
- `outlook`:
  - bullish: `breadth >= 55 && momentum >= 55`
  - bearish: `breadth <= 45 && momentum <= 45`
  - else neutral
- `grade`: thresholds from `config.json`  
  default: `ok >= 60`, `warn >= 50`, else `danger`

**Palette**: reuse Market Meter tokens (`ok`, `warn`, `danger`) for consistent colors.  
**Order**: 11 canonical sectors, title-case, fixed.

**Notes**  
- No backend/workflow changes; this runs locally and later in UI.  
- Validator prints WARN/PASS; non-blocking in prod.
