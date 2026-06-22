---
name: Ornitela new-study first sync
description: Why creating an Ornitela study must trigger its own first sync; the cron cannot bootstrap a study with no deployments.
---

# Ornitela study bootstrap deadlock

A newly created Ornitela-enabled study will NEVER auto-sync from the periodic cron alone.

**Why:** `runOrnitelaSync` (scheduler) iterates `getActiveStudiesWithDeployments()`, i.e. only
studies that already have deployments/individuals. But for Ornitela, deployments/individuals are
created as a *side effect* of `parseOrnitelaCsv` during a sync. So a brand-new study has zero
deployments → cron skips it → no devices discovered → no deployments ever created. Chicken-and-egg.

**How to apply:** Study creation (`POST /api/studies`) must itself kick off the first sync (we do a
fire-and-forget `runOrnitelaFirstSync` via `setImmediate` after `createStudy`). Credentials are
validated synchronously first via `ornitelaSync.login()` so bad creds return 400 immediately.
After at least one device's CSV is imported, the study has deployments and the normal cron takes over.
Do not "fix" the cron by removing the deployments filter — the first-sync-on-create path is the
intended bootstrap. Per-study Ornitela username/password are PANEL creds (cpanel.glosendas.net HTML
scrape), distinct from the global SFTP watcher creds (`ORNITELA_SFTP_PASSWORD`).
