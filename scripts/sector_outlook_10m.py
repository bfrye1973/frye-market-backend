import json, os

CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "config", "sector_outlook_10m.json"
)

def load_10m_outlook_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

CFG = load_10m_outlook_config()

def label_outlook_10m(card):
    b = float(card.get("breadth_pct", 0.0))
    m = float(card.get("momentum_pct", 0.0))

    if b >= CFG["bullish_breadth"] and m >= CFG["bullish_momentum"]:
        return "Bullish"

    if b <= CFG["bearish_breadth"] and m <= CFG["bearish_momentum"]:
        return "Bearish"

    return CFG["default"]
