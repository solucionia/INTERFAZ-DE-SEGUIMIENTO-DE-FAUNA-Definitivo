---
name: GPS quality filter vs transmission status
description: When reading cached_gps_events, choosing HDOP-filtered "latest valid position" vs unfiltered "latest transmission" changes correctness.
---

# HDOP-filtered "latest valid position" is NOT "latest transmission"

`cached_gps_events.hdop` (Horizontal Dilution of Precision) marks GPS fix quality;
points with `hdop > 5` are low quality. There are two distinct "latest GPS" queries
in storage and they are NOT interchangeable:

- `getLatestCachedGpsEvent` — filters `hdop IS NULL OR hdop <= 5`. Use for **position
  accuracy** features (map markers, "última posición válida", dynamic radius / zone
  deviation, mortality radius).
- `getLatestCachedGpsEventAnyQuality` — no HDOP filter. Use for **transmission status**
  (emission monitor / "dejó de emitir"). A low-quality fix still proves the collar
  transmitted, so it must count.

**Why:** the emission monitor migration (Movebank API → local `cached_gps_events`)
first reused the HDOP-filtered helper, which would falsely report a transmitting collar
as "silent" whenever its recent fixes were `hdop > 5`.

**How to apply:** for any "did the device transmit / when did it last transmit"
question, use the AnyQuality variant. For "where is it / how accurate", use the
HDOP-filtered variant. Don't collapse the two.
