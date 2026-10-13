# ENGINE 11 — ZERO-NEW-SPEND DURABLE EVIDENCE RETENTION PROPOSAL V1

Submitted separately to Engine 2B Lead Manager for storage/owner authorization. **Design only; no durable destination selected or provisioned.** The source-verification prototype can be accepted independently of this storage decision.

## Measured inventory and existing boundaries

Six inspected Engine 11 Actions runs hold six artifacts totaling **9,890,545 ZIP bytes**. They expire November 12, 2026 UTC; this is November 11 evening Phoenix. This is a scoped inventory, not account-wide storage usage. A repository-wide artifact listing was unavailable through the connector's supported fetch endpoints. Account plan, total remaining quota, spend limits and account-wide artifact/Packages usage were not exposed; no zero-cost claim is based on an assumed plan.

The two-year candle evidence artifact alone is 9,223,384 ZIP bytes. Its raw JSON receipt container is 74,028,287 bytes, containing 55,454,297 original decoded provider-body bytes in 128 hashed receipts. Independent local gzip/restore yielded 9,179,132 bytes and exactly restored all original bytes and hashes. This measures the acquired research corpus, not a bound on future all-contract histories or retained corrections.

Render inventory: 18 services; no approved Engine 11 research-storage service identified. Core remains on main. The existing 100 GB `/var/data/replay` disk is explicitly excluded by the Manager; its apparent capacity is not authorization to reuse it. No disk contents, services, provider plans, paid settings or production files were changed.

Scratch and CI temporary files prove restore mechanics only. Existing GitHub artifact retention remains 30 days; no setting was extended. Original bodies were not committed as large repository files.

## Recommended zero-new-spend option — existing private owner-controlled storage

Have the Manager designate an **already available private owner-controlled storage location**, plus a separate existing backup destination. Initial requested free capacity: at least **100 MiB per destination** for the measured compressed corpus, manifest, current stage evidence and limited version headroom. This is a proposed initial reservation, not verified available capacity or an unlimited growth guarantee. Measure both destinations before transfer; stop rather than incur paid overages or delete immutable originals.

Proposed objects:

- Original downloaded artifact ZIP, its GitHub digest, creation/expiry metadata and originating commit/run.
- Lossless compressed raw provider receipt container, raw/compressed byte counts and SHA-256 manifests.
- Independently restored source-hash verification report, calendar/dataset manifests and acquisition requests/capture times.
- Separate immutable versions for later observations/corrections. Never replace prior evidence with the latest fetch or interpret an identical response as finality.

Authorization must identify the destination, access method, designated custodian, backup location, allowable data scope and capacity threshold. Confirm confidentiality/access matches the provider data rights; the existing source repository is public, so uploading an entire raw dataset there or to a public release is not an automatic fallback.

After explicit approval: copy original evidence to the two authorized existing destinations, verify transport hashes, restore from each independently into a fresh sandbox, verify all 128 original body hashes, and retain the signed-off manifest in the project. No claim of durable retention until both authorized copies and restore evidence are independently checked. If encryption is required, the custodian must hold recoverable keys separately; no encryption/key-management integration is currently implemented or tested.

Initial cash cost target: **$0 new spend**, conditional on approved existing capacity and its current entitlement. Destination durability, availability, remaining space and backup independence are still unverified. No new account, paid storage, service or deployment is authorized by this proposal.

## Alternatives and limits

| Option | Current status | Decision needed |
|---|---|---|
| Existing private owner-controlled storage + independent backup | Recommended; availability/access not identified | Explicit location/capacity/access/transfer approval |
| Existing authorized private GitHub research release assets | Potential transport/archive option; no suitable repository verified | Access, confidentiality, lifecycle, data scope and owner approval |
| Public repository/release or large raw files in source | Not an approved destination | Separate explicit data/storage authorization; do not default to it |
| Longer Actions retention | Temporary buffer only; not durable | Confirm actual account/repository cap and cost quota first |
| Render replay disk or new service | Prohibited in this scope | Separate production/storage authorization; not recommended for this milestone |

GitHub [retention documentation](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization) permits up to 90 days for public repositories and says new settings do not extend existing objects. Account/organization limits may be lower. Longer retention therefore does not rescue the current artifacts automatically and cannot establish permanence.

GitHub [billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions) lists artifact allowances starting at 500 MB and excess shared storage at $0.25/GB-month. Account-wide allowance is shared with Packages. Even free standard public-repository runner execution does not establish available artifact quota. This proposal does not authorize overage spending or a billing-setting change.

GitHub [release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) allows up to 1,000 assets per release and files below 2 GiB, without a total release/bandwidth limit. Those published technical limits do not establish an approved private location, immutability, provider redistribution rights or a second independent backup. No release was created.

## Acceptance and expiry escalation

Required proof: approved destination and capacity; two hash-verified copies; clean restore from each; raw/compressed manifests; provider receipts and original bodies; credential exclusion; documented access/custodian; independent backup verification; no execution/Replay use.

Preserve by **November 11, 2026 before 6:00 p.m. Phoenix**, ahead of the earliest inventoried expiry. Specifically the full raw candle artifact expires at 6:46:58 p.m. Phoenix. This is an expiry warning in the review record, not a scheduled reminder or an assurance of continued background monitoring. Manager should record a custodian and a transfer deadline before expiry.

Until approved and verified, report **RESTOREABILITY DEMONSTRATED — DURABLE RETENTION UNAVAILABLE**. Do not count local downloads, CI archives, manifests alone or future provider reacquisition as permanent preservation.
