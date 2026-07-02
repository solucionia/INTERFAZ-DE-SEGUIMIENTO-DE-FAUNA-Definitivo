---
name: WildTrack "import limit" is really the display window
description: Reports that old imported data "won't import" or "has a 1-year limit" are almost always the quick-range display window, not the import path.
---

When a user reports Ornitela/Movebank CSV data older than N months/years "doesn't import" or hits a "1-year limit", the import path (import-csv.tsx → POST /api/studies/:id/import-csv → ornitelaCsvParser.ts → storage inserts) has **no age cutoff** — it accepts any date. The real cause is the visualization **date-range window**: viz defaults to 7d, quick "1a"=365d. Data outside the selected window is stored but not shown.

**Why:** verified by E2E test — importing 2-year-old rows returns gpsImported/accImported>0 with 0 errors, is retrievable with a 3-year `getCachedGpsEvents` range, but returns 0 with a 1-year range.

**How to apply:** before touching parser/storage for an "old data" complaint, reproduce by widening the range (use "3a"/"Todo"). The "Todo" quick range can resolve real data bounds via `GET /api/studies/:id/data-range?individuals=...` (aggregates min/max of gps+acc through `storage.getCachedTimestampRange`). Shared quick-range component: `client/src/components/quick-date-range.tsx` (guard stale async "Todo" responses with a request-id ref).
