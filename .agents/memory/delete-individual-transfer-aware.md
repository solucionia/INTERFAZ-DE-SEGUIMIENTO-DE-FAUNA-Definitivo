---
name: Delete-individual must be transfer-window aware
description: How "delete individual completely" must scope telemetry deletion to avoid wiping other animals' data on shared/transferred devices.
---

Deleting an individual and its telemetry cannot simply delete by `(studyId, local_identifier)`: telemetry (cached_gps/acc_events, fetch_ranges, accelerometer_labels by device_id, detected_events) is device-keyed, and a device can move between animals via `device_deployments`.

**Rule:** if the individual has `device_deployments` rows (it was involved in a transfer), delete telemetry only within its ownership windows (`buildDeviceWindows`+`clipWindows` from `server/deploymentWindows.ts`), per device, using timestamp bounds. Only when it has NO `device_deployments` rows does it solely own its `local_identifier` for all time → deleting all rows by `(studyId, local_identifier)` is safe.

**Why:** deleting by local_identifier on a transferred device destroys segments belonging to the previous/next holder (over-deletion); skipping deletion entirely when local_identifier is null under-deletes historical transferred-out animals.

**How to apply:** always also delete `detected_events` keyed by the individual's UUID token (immobility/historical path stores individualLocalId as the UUID). `device_deployments` cascade via FK on individual_id.
