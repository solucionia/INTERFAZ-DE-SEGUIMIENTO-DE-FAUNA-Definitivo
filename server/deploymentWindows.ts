import type { DeviceDeployment } from "@shared/schema";

export interface DataWindow {
  device: string;
  startMs: number;
  endMs: number;
}

const NEG_INF = Number.NEGATIVE_INFINITY;
const POS_INF = Number.POSITIVE_INFINITY;

/**
 * Build the raw device/time windows during which a given individual actually
 * carried a device. If the individual has explicit `device_deployments` rows
 * (i.e. it has been involved in a manual transfer), the windows come from those
 * rows — split by transfer date. Otherwise we fall back to the legacy behaviour:
 * a single unbounded window keyed on the individual's current device
 * (`fallbackDevice`). Historical individuals (no current device) with no rows
 * yield no windows.
 */
export function buildDeviceWindows(
  deployments: DeviceDeployment[],
  fallbackDevice: string | null,
): DataWindow[] {
  if (deployments.length > 0) {
    return deployments
      .filter((d) => d.deviceLocalIdentifier)
      .map((d) => ({
        device: d.deviceLocalIdentifier,
        startMs: d.startDate ? new Date(d.startDate).getTime() : NEG_INF,
        endMs: d.endDate ? new Date(d.endDate).getTime() : POS_INF,
      }));
  }
  if (fallbackDevice) {
    return [{ device: fallbackDevice, startMs: NEG_INF, endMs: POS_INF }];
  }
  return [];
}

/**
 * Intersect windows with a requested finite [tsStart, tsEnd] range, dropping any
 * window that ends up empty. The result always contains finite bounds, safe to
 * pass to SQL. Callers with an "open" range should pass sane finite bounds
 * (e.g. 0 .. Date.now()).
 */
export function clipWindows(windows: DataWindow[], tsStart: number, tsEnd: number): DataWindow[] {
  const out: DataWindow[] = [];
  for (const w of windows) {
    const start = Math.max(w.startMs, tsStart);
    const end = Math.min(w.endMs, tsEnd);
    if (start <= end) out.push({ device: w.device, startMs: start, endMs: end });
  }
  return out;
}
