import importlib.util
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
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
