#!/usr/bin/env python3
import math
import unittest

from scripts.sector_volume import UP, DOWN, UNCHANGED, aggregate_sector_volume
from scripts import build_outlook_source_from_polygon as m10
from scripts import build_outlook_hourly_source as h1
from scripts import build_outlook_source_daily as d1
from scripts import build_outlook_4h_source as h4

FIELDS = (
    "totalVolume","advancingVolume","decliningVolume","unchangedVolume",
    "advancingVolumePct","decliningVolumePct","stocksScanned","stocksWithVolume",
)

class VolumeHelperContractTest(unittest.TestCase):
    def test_contract_missing_nonfinite_zero_and_invariant(self):
        got = aggregate_sector_volume([
            {"classification": UP, "volume": 100},
            {"classification": DOWN, "volume": 40},
            {"classification": UNCHANGED, "volume": 10},
            {"classification": UP, "volume": 0},
            {"classification": DOWN, "volume": None},
            {"classification": DOWN, "volume": float("nan")},
            {"classification": DOWN, "volume": float("inf")},
        ])
        self.assertEqual(got["stocksScanned"], 7)
        self.assertEqual(got["stocksWithVolume"], 4)
        self.assertEqual(got["totalVolume"], 150)
        self.assertEqual(got["advancingVolume"], 100)
        self.assertEqual(got["decliningVolume"], 40)
        self.assertEqual(got["unchangedVolume"], 10)
        self.assertEqual(got["advancingVolume"] + got["decliningVolume"] + got["unchangedVolume"], got["totalVolume"])
        self.assertLessEqual(got["stocksWithVolume"], got["stocksScanned"])

    def test_zero_total_has_null_percentages_and_zero_is_valid(self):
        got = aggregate_sector_volume([{"classification": UP, "volume": 0}])
        self.assertEqual(got["stocksScanned"], 1)
        self.assertEqual(got["stocksWithVolume"], 1)
        self.assertEqual(got["totalVolume"], 0)
        self.assertIsNone(got["advancingVolumePct"])
        self.assertIsNone(got["decliningVolumePct"])

class ProducerClassificationTest(unittest.TestCase):
    def test_10m_price_flags_unchanged(self):
        bars=[{"h":9,"l":5,"c":6},{"h":10,"l":5,"c":7},{"h":11,"l":6,"c":8}]
        self.assertEqual(m10.compute_intraday_flags_10m(bars,3),(0,0,1,0))

    def test_hourly_price_flags_unchanged(self):
        bars=[{"h":i+10,"l":i,"c":i+1} for i in range(11)]
        self.assertEqual(h1.compute_flags_from_bars(bars),(1,0,1,0))

    def test_daily_price_flags_unchanged(self):
        bars=[{"c":float(i)} for i in range(1,11)]
        self.assertEqual(d1.compute_daily_flags(bars,10),(1,0,1,0))

    def test_4h_price_flags_unchanged(self):
        bars=[{"t":i,"h":i+10,"l":i,"c":i+1,"v":100+i} for i in range(21)]
        self.assertEqual(h4.compute_flags_from_bars(bars,20),(20,1,0,1,0))

class FourHourCacheMigrationTest(unittest.TestCase):
    def test_old_cache_missing_volume_fails_missing_not_zero(self):
        sectors={"Technology":["OLD","NEW"]}
        cache={
            "OLD":{"last_bar_time":1,"nh":1,"nl":0,"u3":1,"d3":0},
            "NEW":{"last_bar_time":1,"nh":0,"nl":1,"u3":0,"d3":1,"volume":250},
        }
        card=h4.aggregate_sector_cards_from_cache(sectors,cache)[0]
        for f in FIELDS:
            self.assertIn(f,card)
        self.assertEqual(card["stocksScanned"],2)
        self.assertEqual(card["stocksWithVolume"],1)
        self.assertEqual(card["totalVolume"],250)
        self.assertEqual(card["advancingVolume"],0)
        self.assertEqual(card["decliningVolume"],250)
        self.assertEqual(card["unchangedVolume"],0)

if __name__ == "__main__":
    unittest.main()
