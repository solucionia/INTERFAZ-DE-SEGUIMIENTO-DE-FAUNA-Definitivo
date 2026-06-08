---
name: WildTrack "empty visualization" reports
description: How to triage user reports that the study-visualization map/charts show no data
---
"No veo datos en la visualización" is almost always **data recency**, not a code bug.

**Why:** Ornitela devices transmit intermittently (and SFTP/sync can be dormant for days). The Ornitela study (name "Ornitella") often has far fewer animals with *recent* GPS than total — e.g. ~76 of ~211 animals had data in the last 7d while 211 had data in the last 30d. Selecting a dormant animal with a recent quick-range (7d/24h) correctly returns zero rows.

**How to apply:** Before touching code, verify the pipeline + data with SQL on `cached_gps_events` (recency buckets: last_24h/7d/30d, distinct animals per bucket) and a tsx repro calling `storage.getCachedGpsEvents/getCachedAccEvents`. The `/events` endpoint returns cache directly when the study has no Movebank creds (gaps!=0 but hasMovebank=false path). If data is present, the fix is UX (clear empty-state), not the data path. The GPS map now shows an empty-state when `totalGpsPoints===0`, mirroring the ACC chart.
