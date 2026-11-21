# Engine 11 — March/June 2020 ES rollover evidence (raw, unapproved)

Date: 2026-11-01
Source: authenticated GitHub Actions artifact `engine11-original-es-raw-2020`, artifact ID `13100993075`.
Research status: **observations verified; continuous-series rollover NOT authorized**.

## Receipt integrity

- Artifact includes 185 JSON receipts and one `manifest.json`.
- 108,724 source observations across seven native frames and four quarterly-contract tickers.
- Each receipt's decoded `bodyBase64` SHA-256 matches both its receipt and manifest `bodySha256`: **185/185 PASS**.
- The source rows remain research observations, not chart-certified or execution prices.

## Native session overlap

Matching ESH0 and ESM0 rows by both provider source timestamp and `session_end_date`, using the `1session` frame:

| `session_end_date` | ESH0 close | ESM0 close | ESM0 − ESH0 | ESH0 volume | ESM0 volume |
|---|---:|---:|---:|---:|---:|
| 2020-03-12 | 2449.75 | 2437.25 | −12.50 | 3,648,679 | 811,177 |
| 2020-03-13 | 2664.75 | 2652.75 | −12.00 | 2,190,152 | 2,089,157 |
| 2020-03-16 | 2410.50 | 2399.50 | −11.00 | 1,118,309 | 2,323,164 |

ESM0 first exceeds ESH0 volume on trading session 2020-03-16 **among the sampled matched session bars**. This is not sufficient proof of the exchange roll date or a full-day chart switch instant.

## Required before constructing a continuous view

1. Manager approval of a **single consistent rollover policy**: calendar and volume alternatives are not interchangeable.
2. Preserve the two original unadjusted price streams and all overlap rows. Do not splice two contracts inside a source interval.
3. Confirm provider full contract identity, dated Chicago exchange session boundaries, and source timestamp collisions.
4. Compute coefficient using an explicitly named matched reference session and field (trade close vs settlement); preserve the original prices unchanged. The differences above are individual observations, not approved adjustment coefficients.
5. Expand this research to each quarterly transition, then verify the original October 2024–2026 dataset remains unchanged byte-for-byte before publishing a new separate version.

No production code, LIVE chart, Engine 22 anchors, Fib prices, or trading components are changed by this note.
