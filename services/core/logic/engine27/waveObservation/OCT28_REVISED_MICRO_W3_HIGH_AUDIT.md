# Engine27 V6 — October 28 Micro W3 revised-high audit

Read-only GitHub Actions: https://github.com/bfrye1973/frye-market-backend/actions/runs/40769576951
Source: Backend-1 /api/v1/futures/ohlc, Massive/Polygon resolved ESZ6 by environment override. Window 09:00–16:00 America/Phoenix (16:00–23:00 UTC), Oct 28. **Original Replay physical contract match unverified.**

## Correction to earlier case

The 11:00 AZ 7788.50 high was **not the final high** in this bounded research window. The later **13:01 AZ (20:01 UTC) 1-minute aggregate reached 7819.50**. Owner's rounded 7820 reference is 0.50 higher than returned provider OHLC. Do not rewrite historical Engine22 publications; record new owner revision separately.

| Bar start (AZ) | TF | O | H | L | C | Volume |
|---|---|---:|---:|---:|---:|---:|
| 13:01 | 1m | 7800.75 | 7819.50 | 7799.75 | 7805.25 | 13125 |
| 13:00 | 5m | 7784.75 | 7819.50 | 7783.75 | 7794.50 | 50442 |
| 13:00 | 10m | 7784.75 | 7819.50 | 7783.75 | 7785.00 | 65387 |

1m range 19.75, upper wick 14.25, fraction 72.1519%, lower wick 1.00, bearish body 4.50. The owner-marked 7820 high is not confirmed by this provider query; verified high 7819.50. The previous owner's 7780.50 expectation should be retained separately as a forecast reference, not historical wave completion.

Old Engine26 negotiated zone [7730.25,7758.00] gives distance from revised high to the zone's upper boundary **61.50 points**, *assuming the same zone was published and active at the new high*. Must verify point-in-time zone before claiming contemporaneous proximity. Do not label the initial 11:00 wick as completed wave.

Research status: bounded market data confirmed, no automatic wave completion, no live journal or deployment. No proof of same-contract replay lineage.
