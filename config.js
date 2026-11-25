{
  "version": "r11.2-sectors-10m",
  "bindings": {
    "feed": "https://frye-market-backend-1.onrender.com/live/intraday",
    "sectorCards": "sectorCards",
    "fields": {
      "breadth": "breadth_pct",
      "momentum": "momentum_pct",
      "nh": "nh",
      "nl": "nl",
      "up": "up",
      "down": "down"
    }
  },
  "rules": {
    "aliases": {
      "Information Technology": "Information Technology",
      "Materials": "Materials",
      "Health Care": "Health Care",
      "Communication Services": "Communication Services",
      "Real Estate": "Real Estate",
      "Energy": "Energy",
      "Consumer Staples": "Consumer Staples",
      "Consumer Discretionary": "Consumer Discretionary",
      "Financials": "Financials",
      "Utilities": "Utilities",
      "Industrials": "Industrials"
    },
    "tiltExpr": "(breadth + momentum) / 2",
    "outlook": {
      "bullish": "breadth>=55 && momentum>=55",
      "bearish": "breadth<=45 && momentum<=45"
    },
    "gradeThresholds": {
      "default": { "ok": ">=60", "warn": ">=50", "danger": "<50" },
      "overrides": {}
    }
  },
  "ui": {
    "paletteTokens": { "ok": "ok", "warn": "warn", "danger": "danger" },
    "showNetNH": true
  }
}
