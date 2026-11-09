# Engine 22G — PR #239 technical acceptance evidence

**Development head:** `a569a1da6440f0b34e7ba5209516b78fa191e97e`
**CI:** 10/10 successful on this head, including dedicated `Engine22G Chart Anchors V1` run `41265255961`.
**Generated JSON:** GitHub Actions artifact `engine22g-chart-anchors-generated`, artifact ID `13066308228`.
**Status:** DEVELOPMENT ACCEPTANCE CANDIDATE; PRODUCTION HOLD.

## What was verified
- Current owner selection revision 5 and all seven degree slots.
- Separate Submicro option1 and option2, separate Subminute WICK and BODY ladders.
- Original Fib arrays are copied without recomputation.
- Source owner-chart observations remain unverified; timestamp gaps remain explicit.
- Chart publication uses the same `authorizedWorkingStructure` and `sevenDegreeInvalidations` objects as sibling Engine 22 fields in the strategy wrapper.
- Tests assert matching model/evidence fingerprints, selection revision and source Fib arrays.
- Incomplete strategy emits an explicit unavailable chart packet.
- Price basis is `UNVERIFIED`; `plotAllowed:false`; `historicalAsOfSupported:false`; no trading authority.

## Integration transport
`strategies["intraday_scalp@10m"].engine22WaveStrategy.chartAnchors`

Implementation:
- `services/core/logic/engine22/wave/buildEngine22ChartAnchorsV1.js`
- `services/core/logic/engine22/wave/buildEngine22WaveStrategy.js`

Test and reproducible model sample:
- `services/core/tests/engine22ChartAnchorsV1.test.js`
- `services/core/scripts/generateEngine22ChartAnchorsSample.js`
- `.github/workflows/engine22g-chart-anchors-v1.yml`

Engine 2D mapping:
- `services/core/docs/engine22-chart-anchors-v1-engine2d.md`

## Honest remaining acceptance boundary
The artifact is produced from actual Engine 22 model builders, but it is **not a live deployed full-strategy snapshot**. The feature-branch `chartAnchors` field cannot be read from production until deployment; do not claim it has been observed live. Full runtime/end-to-end acceptance therefore requires an isolated runtime test with authenticated snapshot inputs, followed by separate owner approval for any production release.

Engine 2D may build an isolated consumer using the contract now, but must withhold plotting until source anchor price-basis compatibility is independently established. No merge/deploy authorized.
