import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


scanner = load("engine25_30m", "scripts/build_engine25_30m_internals.py")
archiver = load("engine25_30m_archive", "scripts/archive_engine25_30m.py")


def aggregate_fixture():
    return {
        "nh": 2,
        "nl": 1,
        "up": 2,
        "down": 1,
        "latestBarStartEpochSec": int(
            datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc).timestamp()
        ),
        "totalVolume": 175.0,
        "advancingVolume": 100.0,
        "decliningVolume": 50.0,
        "unchangedVolume": 25.0,
        "advancingVolumePct": 57.14,
        "decliningVolumePct": 28.57,
        "stocksScanned": 10,
        "stocksWithVolume": 9,
    }


def archive_payload():
    return {
        "schema": "engine25.marketInternals30m@1",
        "timeframe": "30m",
        "sourceTimestamp": "2026-10-15T13:00:00Z",
        "generatedAt": "2026-10-15T13:00:42Z",
        "updated_at_utc": "2026-10-15T13:00:42Z",
        "freshnessState": "FRESH_AT_SOURCE",
        "completeCanonicalSet": True,
        "stocksScanned": 5470,
        "stocksWithVolume": 2760,
        "coveragePct": 50.45,
        "advancingStocks": 275,
        "decliningStocks": 227,
        "newHighs": 299,
        "newLows": 259,
        "advancingVolume": 43354710.59,
        "decliningVolume": 47440381.68,
        "sectorCards": [{"sector": name} for name in scanner.ORDER],
    }


class Engine2530mInternalsTests(unittest.TestCase):
    def test_sector_classifier_matches_engine25_55_45_contract(self):
        self.assertEqual(scanner.classify_state(55, 55), "STRONG")
        self.assertEqual(scanner.classify_state(45, 45), "WEAK")
        self.assertEqual(scanner.classify_state(54.9, 60), "NEUTRAL")
        self.assertEqual(scanner.classify_state(40, 50), "NEUTRAL")

    def test_completed_boundary_is_exact_30m_boundary(self):
        now = datetime(2026, 10, 6, 18, 7, 0, tzinfo=timezone.utc)
        self.assertEqual(
            scanner.completed_boundary_utc(now),
            datetime(2026, 10, 6, 18, 0, 0, tzinfo=timezone.utc),
        )

    def test_scan_crossing_boundary_keeps_scan_start_identity(self):
        before_boundary = datetime(2026, 10, 15, 12, 58, 0, tzinfo=timezone.utc)
        after_boundary = datetime(2026, 10, 15, 13, 5, 0, tzinfo=timezone.utc)
        observed_cutoffs = []

        def fake_process_sector(sector, symbols, lookback, days, cutoff_boundary):
            observed_cutoffs.append(cutoff_boundary)
            return aggregate_fixture()

        sectors = {sector: [f"{i:02d}X"] for i, sector in enumerate(scanner.ORDER)}

        with patch.object(scanner, "discover_sectors", return_value=sectors), \
             patch.object(scanner, "process_sector", side_effect=fake_process_sector), \
             patch.object(scanner, "now_utc", side_effect=[before_boundary, after_boundary]):
            payload = scanner.build_payload("unused", 3, 5)

        frozen = datetime(2026, 10, 15, 12, 30, 0, tzinfo=timezone.utc)
        self.assertEqual(payload["sourceTimestamp"], "2026-10-15T12:30:00Z")
        self.assertEqual(payload["generatedAt"], "2026-10-15T13:05:00Z")
        self.assertEqual(len(observed_cutoffs), 11)
        self.assertTrue(all(value == frozen for value in observed_cutoffs))

    def test_every_stock_filter_uses_explicit_frozen_cutoff(self):
        bars = [
            {"t": int(datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)},
            {"t": int(datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc).timestamp() * 1000)},
            {"t": int(datetime(2026, 10, 15, 13, 0, tzinfo=timezone.utc).timestamp() * 1000)},
        ]

        cutoff_1230 = datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc)
        cutoff_1300 = datetime(2026, 10, 15, 13, 0, tzinfo=timezone.utc)

        first = scanner.todays_completed_30m(bars, cutoff_1230)
        second = scanner.todays_completed_30m(bars, cutoff_1300)

        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 2)
        self.assertEqual(first[-1]["t"], bars[0]["t"])
        self.assertEqual(second[-1]["t"], bars[1]["t"])

    def test_archive_uses_source_timestamp_not_archive_time(self):
        payload = {
            "schema": "engine25.marketInternals30m@1",
            "timeframe": "30m",
            "sourceTimestamp": "2026-10-06T18:00:00Z",
            "sectorCards": [{} for _ in range(11)],
        }
        self.assertEqual(
            str(archiver.archive_relative_path(payload)),
            "data/engine25-30m-history/2026-10-06/110000",
        )

    def test_identical_market_observation_ignores_generation_timestamps(self):
        first = archive_payload()
        second = copy.deepcopy(first)
        second["generatedAt"] = "2026-10-15T13:03:03Z"
        second["updated_at_utc"] = "2026-10-15T13:03:03Z"

        self.assertTrue(archiver.market_payloads_equivalent(first, second))


    def test_microscopic_float_drift_is_equivalent(self):
        first = archive_payload()
        second = copy.deepcopy(first)
        second["generatedAt"] = "2026-10-15T14:25:29Z"
        second["updated_at_utc"] = "2026-10-15T14:25:29Z"
        second["decliningVolume"] = first["decliningVolume"] + 0.0000002
        second["advancingVolume"] = first["advancingVolume"] - 0.0000002
        self.assertTrue(archiver.market_payloads_equivalent(first, second))

    def test_material_float_change_is_not_equivalent(self):
        first = archive_payload()
        second = copy.deepcopy(first)
        second["decliningVolume"] = first["decliningVolume"] + 0.01
        self.assertFalse(archiver.market_payloads_equivalent(first, second))

    def test_genuine_market_change_is_archive_collision(self):
        first = archive_payload()
        second = copy.deepcopy(first)
        second["generatedAt"] = "2026-10-15T13:03:03Z"
        second["updated_at_utc"] = "2026-10-15T13:03:03Z"
        second["decliningStocks"] += 1
        second["newLows"] += 1
        second["decliningVolume"] += 1000.0

        self.assertFalse(archiver.market_payloads_equivalent(first, second))

    def test_semantic_compare_preserves_existing_immutable_record(self):
        existing = archive_payload()
        candidate = copy.deepcopy(existing)
        candidate["generatedAt"] = "2026-10-15T13:09:59Z"
        candidate["updated_at_utc"] = "2026-10-15T13:09:59Z"

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "outlook_30m_internals.json"
            original = json.dumps(existing, separators=(",", ":")) + "\n"
            path.write_text(original, encoding="utf-8")

            loaded = json.loads(path.read_text(encoding="utf-8"))
            self.assertTrue(archiver.market_payloads_equivalent(loaded, candidate))
            self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_retention_removes_only_older_than_30_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ["2026-09-05", "2026-09-06", "2026-10-06"]:
                (root / name).mkdir()
            removed = archiver.enforce_retention(
                root, 30, today=date(2026, 10, 6)
            )
            self.assertEqual(removed, ["2026-09-05"])
            self.assertTrue((root / "2026-09-06").exists())
            self.assertTrue((root / "2026-10-06").exists())


if __name__ == "__main__":
    unittest.main()
