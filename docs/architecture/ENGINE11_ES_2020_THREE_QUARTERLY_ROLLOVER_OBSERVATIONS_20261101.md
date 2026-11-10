# Engine 11 — 2020 source-verified quarterly ES contract overlaps

2026-11-01 | Evidence-only; no approved continuous chart rollover.

## Reproducible input

GitHub Actions artifact `engine11-original-es-raw-2020`, ID `13100993075`, 186 ZIP entries: 185 original-response receipt JSON files and `manifest.json`. 108,724 source observations across seven native frames. Original provider response bytes are stored as base64 in receipt field `bodyBase64`; the SHA256 of decoded bytes equals the hash in both the individual receipt and manifest for **185/185** files.

For the table below, filter each decoded Massive native `1session` response by ticker, then inner-join adjacent quarterly contracts on **both** `session_end_date` and `window_start`. Compare original `close` and `volume` without transforming or deduplicating prices. These are observed daily session labels; exchange date/calendar certification is outstanding.

## Crossover summary (native source evidence, NOT approved roll dates)

| Transition | Matched session bars | First session new volume > old volume among matches | Old close | New close | New−old close | Old volume | New volume |
|---|---:|---|---:|---:|---:|---:|---:|
| ESH2020 → ESM2020 | 13 | 2020-03-16 | 2410.50 | 2399.50 | -11.00 | 1,118,309 | 2,323,164 |
| ESM2020 → ESU2020 | 14 | 2020-06-15 | 3076.50 | 3065.50 | -11.00 | 1,001,898 | 2,064,909 |
| ESU2020 → ESZ2020 | 12 | 2020-09-11 | 3337.25 | 3327.00 | -10.25 | 1,109,694 | 1,307,164 |

### Earlier adjacent-session reference values

- March old/new 2020-03-13 close 2664.75/2652.75 (new−old = -12.00), volumes 2,190,152 / 2,089,157.
- June old/new 2020-06-12 close 3035.75/3024.50 (new−old = -11.25), volumes 2,144,934 / 2,062,413.
- September old/new 2020-09-10 close 3341.50/3331.00 (new−old = -10.50), volumes 2,030,545 / 283,686.

### Expiration-window anomalies require deliberate handling

- 2020-03-20 ESH0 close 2445 versus ESM0 2267.25, new−old **-177.75**, while old-contract volume was only 39,467; do not treat this as a representative ordinary adjustment reference.
- 2020-06-19 ESM0 close 3196 versus ESU0 3057.75, new−old **-138.25**, old volume 17,566.
- 2020-09-18 ESU0 close 3367.75 versus ESZ0 3317.25, new−old **-50.50**, old volume 19,144.
- These are observations, not provider errors or approved exclusions; retain untouched for investigation.

## Research conclusion and next gate

1. Native-source data supports three observed volume crossovers, **not** an approved roll policy or exact intraday switch timestamp.
2. The existing post-2024 policy uses selected calendar roll dates, additive close/settlement coefficients and Chicago 17:00 preceding-day effective convention. This cannot be extended backward by choosing first daily volume crossover without explicitly selecting a policy; otherwise old/new history would use inconsistent rules.
3. To preserve continuity with the existing dashboard, compare the 2020 calendar-candidate transition conventions with daily volume observations and source schedules, and select/document one policy for the full historical extension.
4. The December 2020 → March 2021 transition requires the separately archived **2021** responses.
5. Do not modify raw OHLCV, existing 2024–2026 data, the LIVE chart, the 24 anchors, Fibonacci references, or execution modules.

Source code: `services/core/scripts/captureEngine11Historical2020to2024.mjs`, draft PR #242.
