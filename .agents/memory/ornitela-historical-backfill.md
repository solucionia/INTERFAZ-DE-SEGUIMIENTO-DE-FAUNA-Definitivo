---
name: Ornitela panel historical backfill
description: How to recover old Ornitela data the rolling-window sync never pulled, and the Node string-limit gotcha on dense devices.
---

# Ornitela historical backfill

The Ornitela cpanel (e.g. cpanel.glosendas.net) retains a long history per device, but the
app's normal sync only ever pulls a short rolling window (first-sync constant ~168h), so older
GPS/ACC can appear "missing" in the DB even though the panel still has it. This is a sync-window
limitation, not a query filter or DB bug.

**How to backfill:** `scripts/ornitela-backfill.ts` (run with `WILDTRACK_NO_BOOT=1` so importing
server modules doesn't start the server/scheduler/SFTP watcher). It logs in, lists devices, and
per device downloads `downloadCSV(from,to)` → `parseOrnitelaCsv` (idempotent: dedups against
cached_gps/acc_events, so re-runs are safe). Env knobs: `HOURS_BACK`/`END_HOURS_BACK` (window),
`START_INDEX`/`MAX_DEVICES` (pagination), `DEVICE_IMEI` (single device), `VERIFY=1` (connectivity),
`KEEP_ALIVE=1` (hang at end for workflow use).

**Run it as a managed Workflow, not detached.** Replit kills `nohup`/`setsid` detached processes
on the next tool call; foreground bash is capped at ~120s. A console Workflow survives across
tool calls — point it at the script writing to a `/tmp/*.log`, monitor the log, then removeWorkflow.

**Node ~512MB string limit (the real gotcha):** `downloadCSV` builds the whole CSV as one JS
string. A *dense* device over a 1-year window can exceed `0x1fffffe8` chars (~512MB) →
`Cannot create a string longer than 0x1fffffe8 characters`. A 3-month window can still be ~500MB
(right at the edge) and is also very slow to parse. Recover such devices with **monthly windows**
(~730h each). The script now auto-splits a window in half on an oversize error down to
`MIN_SPLIT_HOURS`, so this is handled, but monthly chunking up front is faster/safer for the
known-huge devices.

**Why:** confirmed in practice — a full backfill recovered ~3.3M GPS + 3.4M ACC across 237/273
devices with 0 parse errors; the single failure was the one ultra-dense device hitting the string
limit.
