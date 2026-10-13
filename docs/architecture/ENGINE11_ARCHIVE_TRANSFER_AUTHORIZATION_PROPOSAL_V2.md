# Engine 11 — Archive Transfer Authorization Proposal V2

Status: archive/restore package ready in local and CI sandboxes; private destinations and transfer authorization still pending. No paid service, public release, source-repository dataset or Render replay copy was created.

## Measured package

The original container remains 74,028,287 bytes, with 128 verified source receipts and 55,454,297 decoded body bytes. Original file SHA-256: `174886f9b80a1363dc4bd87262b2a4e5fbe004185157c928b4c42a9535e3b1b9`. Each gzip member is 9,179,132 bytes; JSON archive with manifest/base64 is 12,239,614 bytes. Immutable package version is derived from the manifest SHA-256, and writes refuse overwrite.

Two separate sandbox directories independently read, checksum and restore that full package exactly. Both copies remain on the same temporary filesystem; **backupIndependenceVerified=false, durable=false**. The independent CI runner also downloaded the original Actions artifact and verified/restored both sandbox copies. These are independent restore executions, not two approved durable backup locations.

An overnight scratch working copy was found truncated by JSON/file-hash checking. It was restored from the original Actions ZIP after verifying both the ZIP SHA and the previously recorded raw-container SHA. No analysis result was accepted from the truncated copy. This reinforces the explicit temporary-storage limitation.

## Existing destination inventory

| Existing candidate | Verified metadata/access | Unverified requirements | Proposed custodian/cost |
|---|---|---|---|
| ChatGPT Library owned folder `/Frye Dashboard 2` | Existing owned folder found via connected metadata; folder ID `6a4ff35787748191b77c8aac9fc6884f` | Remaining capacity, persistent-archive access/lifecycle, independent backup, data-use scope and actual transfer approval | Project owner as proposed custodian, not yet designated; zero new spend conditional on existing capacity |
| Existing private GitHub research repository | Connected account search for `user:bfrye1973 is:private` returned no repositories visible to this connector | A suitable private location is not established; result does not prove none exists elsewhere | Not selected or created |
| Existing Render storage | Core's 100 GB replay disk exists | Explicitly excluded; size is not authorization for research storage | Not a candidate |
| Separate existing owner-controlled private backup | No independently located existing resource identified | Exact name/path/account, access, capacity, custodian, confidentiality and restore capability | Lead Manager must identify; no new paid service authorized |

No raw evidence was uploaded to Library or any proposed private destination. Metadata access alone does not certify 100 MiB free capacity or a second durable copy. No unrelated file contents were read.

## One explicit transfer decision needed

Engine 2B should identify and verify the first private destination and independently located backup, with at least 100 MiB initial free space each; confirm existing capacity entails no new spend and matches data confidentiality/license scope; designate custodians and recovery access; and obtain one owner authorization for the named destinations and exact evidence package. If the owned file-store candidate is selected, confirm its capacity and backup arrangement rather than presuming it qualifies.

After that decision, transfer lossless compressed archive, source ZIP/manifests and compact reports; verify hashes from each destination; restore into clean sandboxes; verify all 128 body hashes; record success/failure and capacity. Retain revisions separately; never overwrite the previous evidence or delete unresolved observations to fit a quota. Any encryption/recovery-key procedure requires its own accepted implementation; none is claimed as tested here.

Existing full candle artifact expires **November 11, 2026 at 6:46:58 p.m. Phoenix**. Earliest inventoried artifact expires at 6:00:11 p.m. that day. Preserve before 6:00 p.m.; this review records an expiry warning, not an automation or background-monitoring claim. Current artifacts remain temporary with 30-day retention. Physical independence, available capacity and durable retention are genuine approval/access blockers.

The existing zero-new-spend retention proposal's GitHub quota/retention caveats remain applicable. Initial 100 MiB reservations are based on measured compressed package size and headroom, not a forecast of unlimited historical revisions or a verified storage quota. No infrastructure setting or purchase has been changed.
