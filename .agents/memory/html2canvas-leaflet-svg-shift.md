---
name: html2canvas Leaflet SVG overlay shift
description: Why Leaflet vector overlays (KDE/MCP polygons) shift in PNG/PDF export while tiles stay aligned, and how to fix it.
---

# Leaflet vector overlays shift west/north in html2canvas PNG/PDF export

When exporting a Leaflet map to PNG/PDF via `html2canvas`, raster tiles and
DOM markers come out aligned but **SVG vector overlays (the default react-leaflet
GeoJSON renderer drawing KDE/MCP home-range polygons) shift west/north**.

**Why:** Leaflet positions `<svg class="leaflet-zoom-animated">` using BOTH a CSS
`transform: translate3d(b.min.x, b.min.y, 0)` AND a `viewBox` whose min equals
`b.min`. On screen they cancel (viewBox maps path point P to svg-pixel `P - b.min`,
the CSS translate puts the svg back at `b.min` → net = P). But when html2canvas
**rasterizes an `<svg>` element it honors the internal viewBox offset yet DROPS the
element's own CSS transform**, so vector content lands at `P - b.min` → shifted by
`-b.min`. Plain `<img>` tiles / `<div>` markers keep their `translate` (html2canvas
honors transforms on those), which is why only the vectors move.

**Fix (in the `onclone` of the html2canvas call):** for `.leaflet-overlay-pane svg`
specifically, move the offset off the CSS transform and onto the layout box —
`style.transform = 'none'; style.left = tx+'px'; style.top = ty+'px'`. html2canvas
honors layout (`left/top`) position; the svg is `position:absolute` via Leaflet CSS.
Keep the existing `translate3d/matrix3d → translate()` normalization for non-svg
panes/tiles/markers.

**How to apply:** this lives in `captureMap()` in `client/src/pages/geo-analysis.tsx`.
If you add map PNG/PDF export elsewhere (e.g. study-visualization.tsx uses plain
`html2canvas` without this onclone), reuse the same logic or vector layers will shift.
The fix is idempotent — `left/top + transform:none` is visually equivalent even if a
future html2canvas version starts honoring svg transforms.
