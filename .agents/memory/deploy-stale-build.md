---
name: Fix committed but "not in production"
description: When a code fix exists/committed but production still shows old behavior, suspect an un-republished build before re-debugging the code.
---

# "El fix está en el código pero en producción sigue pasando"

**Rule:** A committed fix does NOT reach production automatically. Replit deployments
(both Autoscale and Reserved VM) only rebuild when the user clicks **Publish** again.
Code merged/committed after the last publish keeps running the previous build in prod.

**Why:** Burned a debugging cycle on the KDE/map export offset fix (`captureMap()` in
`client/src/pages/geo-analysis.tsx`, commit "Align map exports by fixing coordinate
transformations"). The code was correct and committed for a week, but prod (Autoscale)
was never republished, so it served a pre-fix build. A republish fixed it with zero
code changes.

**How to apply — verify before touching code:**
1. `getDeploymentInfo()` → confirm `deploymentType` and `hasSuccessfulBuild`.
2. Fetch the live bundle and grep for a string-literal signature of the fix that
   survives minification (e.g. a CSS class like `leaflet-marker-shadow`), and check the
   bundle/index.html `last-modified` header vs. the fix commit date. If the signature is
   absent or the build predates the commit → it's a stale build, not a code bug.
3. Check `cache-control` on `index.html` (should be `max-age=0`); Vite hashes asset
   filenames, so a stale client just needs a hard refresh once index.html revalidates.
