# Engine 8D Phase 2 — seven MANUAL PAPER account activation

**Status:** Feature branch only. NO merge, production deployment, production account initialization or production trade authorized until Engine 8A accepts both PRs.

## Confirmed foundation
- PR #98 merge commit `5e1094ab368ca99f682aee80da6f78b911e1840f` reported LIVE by Render.
- New account files reside only beneath `/var/data/replay/engine8-paper`.
- No historical PAPER migration, no REAL Journal/Broker/OAuth/watermark changes.

## Permanent accounts
PAPER-01-SUBMICRO = INTRADAY_SUBMICRO; PAPER-02-MICRO = MICRO; PAPER-03-SUBMINUTE = SUBMINUTE; PAPER-04-MINUTE = MINUTE; PAPER-05-MINOR = MINOR; PAPER-06-INTERMEDIATE = INTERMEDIATE; PAPER-07-PRIMARY = PRIMARY. Each exactly $10,000, total $70,000. Accounts initialized explicitly exactly once. No automatic init on start/GET.

## Auth boundary and first-use activation
The browser never receives `ENGINE8_ADMIN_SECRET` and no admin secret is bundled into JavaScript.

1. Engine 8A explicitly approves deploying backend PR #99 and frontend PR #41. Do not change `main` until approved.
2. With separate authorization, configure `ENGINE8_MANUAL_PAPER_ALLOWED_ORIGINS` to the exact HTTPS frontend origin(s). Blank/unrecognized origin fails closed. This setting is NOT changed by the feature branch.
3. Admin, from a trusted server-side context only, requests `POST /api/trading/manual-paper/access/pairing` using existing protected Engine 8 admin auth. The server returns a 5-minute, one-use pairing code. **Never send the Engine 8 admin secret to the browser.**
4. The owner opens `/manual-paper-accounts`, enters the one-use pairing code, receives an hour-long scoped bearer token in volatile browser memory. Reload or expiry requires re-pairing. No localStorage or durable browser token storage.
5. The owner explicitly confirms creation of seven accounts. `POST /api/trading/manual-paper/initialize` is idempotent, refuses corrupted active data and never resets existing capital.
6. Verify seven distinct IDs, $10,000 starting balances and zero positions in a read-only overview. Confirm combined $70,000 starting capital.
7. No PAPER production test trades until separately authorized.

## Trading rules
Owner submits BUY/SELL/REDUCE/CLOSE with explicit accountId, ES/MES expiration, positive integer qty, 0.25 tick manual price, intent and unique key. UI requires explicit preview and checkbox. Backend additionally requires `ownerConfirmation=CONFIRM_PAPER`, authenticates scoped session or server-side admin, enforces kill switch, margin, contract limit and account ownership.

Default simulated margin: ES $15,000 / MES $1,500 per contract. Default fees per side: ES $2.50 / MES $1.25 per contract. Optional environment overrides: `ENGINE8_MANUAL_PAPER_MARGIN_ES`, `ENGINE8_MANUAL_PAPER_MARGIN_MES`, `ENGINE8_MANUAL_PAPER_FEE_ES`, `ENGINE8_MANUAL_PAPER_FEE_MES`, `ENGINE8_MANUAL_PAPER_MAX_CONTRACTS`. These are simulation assumptions, NOT broker terms.

The separate Engine 10 module owns per-contract IDs, FIFO closes, trade IDs and realized accounting. Engine 8 owns simulated execution/order IDs and idempotency. Engine 10 Journal failure leaves the account blocked until the original fill is replayed through the Journal-only endpoint. Never submit a replacement instruction to cure an ambiguous execution.

The account equity's unrealized mark uses entry/last manual execution basis only; **no live-market mark-to-market feed is currently wired**. This restriction must be documented until approved read-only valuation data is added.

## Deployment and rollback
Merge sequence, only with Engine 8A approval: backend #99 first, verify health and authentication -> frontend #41 second -> inspect account store -> pair operator -> explicitly initialize seven accounts -> verify safe read-only balances -> enable owner-directed manual trading. Stop on any failure; do not execute trades or reset records.

Rollback: disable new PAPER instructions, preserve five existing foundation records plus manual-paper account, execution, Journal and session files. Revert code only with Manager approval. Never roll back REAL fills, journals or Schwab connections. Preserve original PAPER execution IDs and Journal-pending records during an incident.

## Chat
ChatGPT has NOT been granted a verified authenticated direct execution action. Chat commands are preparation only; execute through the approved Dashboard ticket after explicit owner confirmation.
