---
name: ACC immobility detector map
description: Where ACC "immobility/position-repetition" detection actually lives, and which one causes false positives.
---

# ACC immobility / "position repetition" detection

Users often ask to fix "the ACC immobility detector" as if the same logic exists in three
places (mortality detector, event detector, visualizer). It does NOT. The real layout:

- **Visualizer** (`client/src/pages/study-visualization.tsx`) has **no** client-side ACC
  detection. It only calls `POST /api/studies/:id/detect-events` and renders results. Not a
  detector — do not "fix" logic there.
- **Event detector** (`server/eventDetection.ts` → `detectMortality`) uses `variance()` over a
  ~24h window and ALREADY requires all three axes simultaneously
  (`xVar<max && yVar<max && zVar<max`). It has no pairwise-drift bug. Do NOT swap its proven
  24h-variance rule for a short 3-sample rule — that risks MISSING real deaths (false negatives).
- **Real false-positive source**: `server/immobilityDetector.ts` → `detectAccConsecutiveImmobility`.
  It runs every ~5 min on all active animals via cron.

**The drift bug (fixed):** the old check compared only CONSECUTIVE PAIRS
(`|dX|,|dY|,|dZ| < threshold`), so an animal could move +19 then +19 (total range 38) across 3
samples and still be flagged immobile. Correct approach = per-axis RANGE (max−min) across the
whole 3-sample window, all three axes simultaneously.

**Why it matters:** a stricter max−min-over-window rule is mathematically ⊆ the old pairwise
rule, so the flagged count can only drop, never rise — safe to ship without a live backtest.

**How to apply:** for "too many immobility false positives", target
`detectAccConsecutiveImmobility` first; leave `eventDetection.detectMortality` alone unless the
user explicitly wants the mortality model itself changed.

# Fight / predation ACC signature

`eventDetection.detectPredationFight` (eventType `predation_fight`) detects fights, NOT
`detectFight` (eventType `fight`, a separate Z-alternating detector — leave it alone).

**Domain fact (non-obvious):** a real fight is a burst of violent oscillation — Z plunges very
negative (−200/−300/−400) while X spikes high (+200/+300), on DIFFERENT samples, not stable and
not consecutive. The original detector required Z to swing both >+200 AND <−200 within N
*consecutive* samples (Z-only, ignored X), so confirmed fights never fired.

**Correct model:** slide a time window (`windowMinutes`) and fire when it contains ≥1 puntual
sample with `z < zThreshold` AND ≥1 with `x > xThreshold` (co-occurrence across axes, isolated
values OK). Severity escalates by how extreme (crit if minZ<−400 or (minZ<−300 && maxX>300)).

**Why:** validated on real GREFA data (late June) — fight-signature devices reached Z −702 / X
741; the consecutive+Z-only rule missed them. A 10-min window gives good specificity (animals
whose lone Z-dip and X-spikes are hours apart correctly do NOT fire).
