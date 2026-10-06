#!/usr/bin/env python3
import importlib.util
import os
import unittest

ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),".."))
PATH=os.path.join(ROOT,"scripts","make_dashboard.py")
spec=importlib.util.spec_from_file_location("make_dashboard",PATH)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class TenMinuteCanonicalSectorTest(unittest.TestCase):
    def test_populated_aliases_are_canonicalized_without_losing_fields(self):
        cards=[]
        for name in m.ORDER:
            if name=="Information Technology":
                cards.append({"sector":"tech","breadth_pct":61,"momentum_pct":62,"nh":3,"nl":1,"up":4,"down":2,
                              "totalVolume":1000,"advancingVolume":600,"decliningVolume":300,"unchangedVolume":100,
                              "advancingVolumePct":60,"decliningVolumePct":30,"stocksScanned":50,"stocksWithVolume":49})
            elif name=="Health Care":
                cards.append({"sector":"Healthcare","breadth_pct":41,"momentum_pct":42,"nh":1,"nl":3,"up":2,"down":4,
                              "totalVolume":2000,"advancingVolume":400,"decliningVolume":1400,"unchangedVolume":200,
                              "advancingVolumePct":20,"decliningVolumePct":70,"stocksScanned":60,"stocksWithVolume":58})
            else:
                cards.append({"sector":name,"breadth_pct":50,"momentum_pct":50,"nh":0,"nl":0,"up":0,"down":0})

        out=m.ensure_sector_cards({"sectorCards":cards})
        self.assertEqual(len(out),11)
        self.assertEqual([x["sector"] for x in out],m.ORDER)
        self.assertNotIn("tech",[x["sector"] for x in out])
        self.assertNotIn("Healthcare",[x["sector"] for x in out])

        tech=out[0]
        health=out[2]
        self.assertEqual(tech["totalVolume"],1000)
        self.assertEqual(tech["stocksScanned"],50)
        self.assertEqual(tech["breadth_pct"],61)
        self.assertEqual(health["totalVolume"],2000)
        self.assertEqual(health["stocksWithVolume"],58)
        self.assertEqual(health["momentum_pct"],42)

if __name__=="__main__":
    unittest.main()
