---
name: hover-elevate specificity trap
description: Why `hover-elevate` silently overrides absolute positioning + z-index on the same element, and how to fix it.
---

The global utility class `hover-elevate` (client/src/index.css, `@layer utilities`) is defined with the selector `.hover-elevate:not(.no-default-hover-elevate)`. The `:not(.class)` argument raises its specificity to (0,2,0), which BEATS Tailwind's `.absolute` and `.z-[N]` utilities (both (0,1,0)) in the same cascade layer. The rule forces `position: relative; z-index: 0` onto the element.

**Symptom:** An element with `className="absolute top-2 right-2 z-[1001] ... hover-elevate"` is silently pulled out of its absolute placement into normal flow AND dropped to z-index:0 — so it lands in the wrong corner and/or hides behind siblings with higher z-index. Confusing because the Tailwind classes look correct.

**Fix:** Never put `hover-elevate` on the same element that needs explicit absolute/fixed positioning or a z-index. Put positioning + z-index on a wrapper `<div>` (no hover-elevate) and keep `hover-elevate` on the inner element purely for its hover ::after overlay. The wrapper's stacking context scopes the forced z-index:0 locally.

**How to apply:** When any `hover-elevate` element must be absolutely positioned or layered above others (floating buttons, overlays, badges over maps), wrap it. Check for this pattern whenever a hover-elevate element appears mispositioned or hidden.
