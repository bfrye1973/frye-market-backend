# Micro + Negotiated Midline A++ Confluence

Manager-approved Strategy 1 quality context.

## Rule

When the canonical Engine 22 Micro active wave is W1, W2, W3, W4, or W5 and price is at/near the canonical Engine 26 negotiated midpoint, publish:

```
A++ TRADING HAPPENING
```

This is a confluence-quality label only.

## Canonical proximity

- Exact midpoint contact: current price within one ES tick of midpoint, or a completed 10m candle traded through the midpoint.
- Near midpoint: reuse Engine 26's existing `activationRangePoints`. Do not invent a second independent proximity threshold.
- Historical touch remains visible during the current candidate lifecycle so a move away from midpoint does not erase the important setup event.

## Scope

The classifier is valid for all Micro impulse/correction waves:

```
W1
W2
W3
W4
W5
```

The active Micro wave and timing state must still be structurally usable. INVALIDATED and RECOUNT_REQUIRED states cannot qualify.

## Ownership guardrails

This feature must not rewrite Engine 26 canonical setup identity or grade.

```
Engine 26 setupGrade remains unchanged.
A++ = Micro + negotiated-midline confluence quality.
```

The feature creates:
- no permission,
- no sizing,
- no management action,
- no execution,
- no journal mutation.

## Training

Every active A++ event publishes training tags including:
- Micro wave,
- Micro timing state,
- exact midpoint contact vs completed 10m touch vs near-midline,
- canonical countId.

Replay analytics should later compare A++ events with forward 10m/30m/60m/end-of-session behavior and actual paper outcomes.
