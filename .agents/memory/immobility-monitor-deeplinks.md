---
name: Immobility-monitor alert-row deep links
description: Binding per-row action links (maps, accelerometer) to the analyzed study, not the live selector
---

Alert tables in `client/src/pages/immobility-monitor.tsx` are rendered from `result` (a one-shot analysis), but the study `<Select>` (`selectedStudyId`) stays mutable afterward.

**Rule:** any per-row link/action built from the displayed alerts (e.g. the accelerometer deep link `/study/<id>/visualize?animal=<localId>`) must use the study id captured when the analysis ran (`analyzedStudyId`), NOT `selectedStudyId`. Also clear `result`/`analyzedStudyId` when the selector changes.

**Why:** if a user runs analysis for study A then switches the selector to B without re-running, the old A rows remain on screen; links keyed to `selectedStudyId` would point to `/study/B/...` with animal ids from A → broken preselect.

**How to apply:** when adding new row actions here, key them off `analyzedStudyId`. The visualize page (`study-visualization.tsx`) reads `?animal=` once on load (guarded by `didInitFromUrl`), validates membership, sets a 7d range and auto-loads — a plain `<a target="_blank">` is intentional so the new tab boots a fresh SPA instance that runs that init.
