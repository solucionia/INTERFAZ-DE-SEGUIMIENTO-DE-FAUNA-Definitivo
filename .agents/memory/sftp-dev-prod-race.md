---
name: SFTP dev/prod race
description: Ornitela SFTP watcher must be disabled in dev to avoid stealing files from prod
---
The Ornitela SFTP watcher moves each CSV to /uploads/processed after importing, so whichever environment polls first consumes the file and the other never sees it. Dev and prod use different databases, so a watcher running in the dev Workspace silently diverts telemetry away from production.

**Why:** Dev and prod both ran the watcher against the same SFTP feed, causing missing data in prod (July 2026).

**How to apply:** Keep `ORNITELA_SFTP_DISABLED=1` set in the development environment only; only the published deployment should consume the SFTP feed. If dev testing of the watcher is needed, temporarily remove the var and expect prod to miss those files.
