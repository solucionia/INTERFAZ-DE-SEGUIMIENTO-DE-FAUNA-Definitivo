---
name: Device-transfer window clipping (Fase 2)
description: When a device/emitter (localIdentifier) is reassigned between animals, every GPS/ACC read path must clip by device_deployments windows — not just query by device.
---

Cached GPS/ACC rows (`cached_gps_events`/`cached_acc_events`) are keyed only by
`studyId + individualLocalIdentifier` (the device/IMEI), NOT by animal. So a
device reassigned between animals over time has one flat stream; per-animal
attribution comes ONLY from `device_deployments` (start_date/end_date windows).

**Rule:** any read that answers a per-animal question must go through the
deployment windows (`buildDeviceWindows` + `clipWindows` in
`server/deploymentWindows.ts`), never a raw device-keyed query.

**Why:** device-keyed helpers leak the previous holder's data. The subtle one
was the immobility detector's no_transmission path: a just-transferred animal
with zero post-transfer points would inherit the *previous* holder's last
transmission timestamp, misclassifying it as "active"/wrong no_transmission.

**How to apply:** the easy-to-miss leaks are "latest event" and "has any
history" prefilters, not just range queries. Windowed equivalents exist:
`storage.getCachedGpsEventsForWindows`, `getLatestCachedGpsEventForWindows`
(with `qualityOnly` flag: false = "ever transmitted", true = HDOP-filtered
"última posición válida"). In `immobilityDetector.ts` use the `clippedGps` /
`clippedAcc` / `latestClippedGps` helpers, never `getLatestCachedGpsEvent` /
`getCachedTimestampRange` by device.

**Token resolution:** a data token can be the current holder's `localIdentifier`
OR a transferred animal's `individualId` (UUID, localId now NULL). Routes resolve
via `resolveDataWindows`. No collision today because UUIDs ≠ IMEIs.

**Known open edge (minor):** window bounds are inclusive on both sides (lte/gte),
so a point whose timestamp == transferDate falls in BOTH source and destination
windows (double-counted at the exact boundary). Not fixed; decide ownership if it
ever matters.
