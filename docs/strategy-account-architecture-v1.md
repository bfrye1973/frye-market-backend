# Redline Strategy Account Architecture v1

Locked capital and strategy-role baseline:

| Account role | Capital | MES operating cap | Structural owner |
| --- | ---: | ---: | --- |
| INTRADAY | $16,000 | up to 5 MES | Micro |
| SUBMINUTE | $10,000 | up to 4 MES | Subminute |
| MINUTE | $3,000 | 1 MES | Minute |
| MINOR | $3,000 | 1 MES | Minor |
| INTERMEDIATE | $3,000 | 1 MES | Intermediate |
| PRIMARY | $3,000 | 1 MES | Primary |
| RESERVE | $8,000 | none | portfolio reserve |

Total capital: $46,000.

Existing Schwab bindings keep historical Engine 10 Journal names unchanged.

- SCHWAB_6380 maps to strategy role INTRADAY; historical Journal name remains INTRADAY.
- SCHWAB_0747 maps to strategy role SUBMINUTE; historical Journal name remains SWING.

This separation prevents strategy-role migration from rewriting Engine 10 history.

The future MINUTE, MINOR, INTERMEDIATE, and PRIMARY roles remain unbound until those real Schwab accounts exist.

Structural hierarchy:
- INTRADAY: Micro owns timing; Subminute and Minute are parent context.
- SUBMINUTE: Subminute owns thesis; Micro is entry timing; Minute through Primary are parent context.
- MINUTE: Minute owns thesis; Subminute/Micro are lower-degree timing; Minor through Primary are parent context.
- MINOR: Minor owns thesis; lower degrees are timing/context; Intermediate/Primary are parents.
- INTERMEDIATE: Intermediate owns thesis; lower degrees are timing/early warning; Primary is parent.
- PRIMARY: Primary owns thesis; all lower degrees are timing/early-warning context only.

A lower degree does not automatically invalidate a higher-degree position.

Ownership remains:
- Engine 22: structural truth.
- Engine 7: sizing authority.
- Engine 8: execution and broker-fill observation.
- Engine 10: journal and open-position truth.
- Engine 13: notifications only.
- Engine 28A: Replay/training measurement only.

The registry itself never moves cash, opens accounts, approves futures, sizes positions, creates orders, or mutates Journal state.