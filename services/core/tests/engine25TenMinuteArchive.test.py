import importlib.util
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[3] / "scripts" / "archive_engine25_10m.py"
spec = importlib.util.spec_from_file_location("archive_engine25_10m", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def card(name, breadth, momentum, up=10, down=5, nh=3, nl=1):
    return {
        "sector": name,
        "breadth_pct": breadth,
        "momentum_pct": momentum,
        "up": up,
        "down": down,
        "nh": nh,
        "nl": nl,
        "advancingVolume": 100.0,
        "decliningVolume": 50.0,
        "unchangedVolume": 25.0,
        "stocksScanned": 100,
        "stocksWithVolume": 90,
    }


class Engine25ArchiveTests(unittest.TestCase):
    def fixture(self):
        cards = []
        for i in range(11):
            if i < 3:
                cards.append(card(f"S{i}", 60, 60))
            elif i < 8:
                cards.append(card(f"S{i}", 50, 50))
            else:
                cards.append(card(f"S{i}", 40, 40))
        return {
            "updated_at_utc": "2026-10-06T13:30:00Z",
            "sectorCards": cards,
            "meta": {"last_full_run_utc": "2026-10-06T13:30:00Z"},
        }

    def test_build_record_preserves_raw_and_summary_truth(self):
        record = mod.build_record(
            self.fixture(),
            archived_at=datetime(2026, 10, 6, 13, 31, tzinfo=timezone.utc),
        )
        self.assertEqual(record["schema"], mod.SCHEMA)
        self.assertEqual(record["sourceTimestamp"], "2026-10-06T13:30:00Z")
        self.assertEqual(record["strongSectorCount"], 3)
        self.assertEqual(record["neutralSectorCount"], 5)
        self.assertEqual(record["weakSectorCount"], 3)
        self.assertEqual(record["advancingStocks"], 110)
        self.assertEqual(record["decliningStocks"], 55)
        self.assertAlmostEqual(record["advancingBreadthPct"], 66.6666666667)
        self.assertEqual(record["newHighs"], 33)
        self.assertEqual(record["newLows"], 11)
        self.assertEqual(record["netNewHighsLows"], 22)
        self.assertEqual(record["advancingVolume"], 1100.0)
        self.assertEqual(record["decliningVolume"], 550.0)
        self.assertAlmostEqual(record["advancingVolumeShare"], 66.6666666667)
        self.assertAlmostEqual(record["coveragePct"], 90.0)
        self.assertEqual(len(record["sectorCards"]), 11)
        self.assertEqual(record["sectorCards"][0]["up"], 10)

    def test_archive_path_uses_canonical_timestamp_in_phoenix(self):
        record = mod.build_record(self.fixture())
        self.assertEqual(
            str(mod.archive_relative_path(record)),
            "data/engine25-10m-history/2026-10-06/063000",
        )

    def test_missing_timestamp_fails_closed(self):
        payload = self.fixture()
        payload.pop("updated_at_utc")
        payload["meta"] = {}
        with self.assertRaises(ValueError):
            mod.build_record(payload)

    def test_incomplete_sector_set_is_preserved_as_incomplete(self):
        payload = self.fixture()
        payload["sectorCards"] = payload["sectorCards"][:10]
        record = mod.build_record(payload)
        self.assertFalse(record["completeCanonicalSet"])
        self.assertEqual(record["freshnessState"], "INCOMPLETE_AT_SOURCE")

    def test_retention_removes_only_dates_older_than_30_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ["2026-09-05", "2026-09-06", "2026-10-05", "not-a-date"]:
                (root / name).mkdir()
            removed = mod.enforce_retention(root, 30, today=date(2026, 10, 6))
            self.assertEqual(removed, ["2026-09-05"])
            self.assertFalse((root / "2026-09-05").exists())
            self.assertTrue((root / "2026-09-06").exists())
            self.assertTrue((root / "2026-10-05").exists())
            self.assertTrue((root / "not-a-date").exists())


if __name__ == "__main__":
    unittest.main()
