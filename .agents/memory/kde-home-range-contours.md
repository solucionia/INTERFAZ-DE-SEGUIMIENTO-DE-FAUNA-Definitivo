---
name: KDE home-range contours
description: WildTrack kernel home-range polygons use a hand-rolled marching-squares isoline extractor, not d3-contour or a convex hull.
---

# KDE home-range contours (server/geoAnalysis.ts)

`computeKernelMultiPercent` builds each percentile home range from a REAL density
isoline (marching squares over the density grid), equivalent to adehabitatHR's
`getverticeshr()`. It is NOT a convex hull and NOT d3-contour.

**Why hand-rolled (not d3-contour):** d3-contour was never installed, and the
package installer (code_execution river service) was down when this was written.
Marching squares is small, dependency-free, and gives direct control over the
grid→lng/lat mapping. Keep it this way unless there is a strong reason to add the
dep — don't "modernize" it back to d3-contour or revert to `turf.convex`.

**How to apply / invariants if you touch this code:**
- Grid is `turf.pointGrid` (uniform degree spacing); reconstruct the lattice from
  the density points, pad with a `-1` border so contours always close inside the
  domain, then map back with the `(p-1)` offset.
- Holes vs outers are decided by point-in-ring containment depth parity (even =
  outer, odd = hole). Disjoint cores legitimately yield a MultiPolygon — that is
  the whole point vs a convex hull (verified: two separated clusters → 2 parts).
- `area_km2` must come from `turf.area(feature)/1e6` on the real geometry.
- Preserve properties exactly: `type:"kernel"`, `method`, `percent`, `level`,
  `area_km2`. Per-percentile fallback to `turf.convex` when the isoline is
  empty/invalid.
- Do not touch `computeMCPMultiPercent` or the bandwidth logic
  (`silvermanBandwidth`, `computeLSCVBandwidth`) — they are independent.
