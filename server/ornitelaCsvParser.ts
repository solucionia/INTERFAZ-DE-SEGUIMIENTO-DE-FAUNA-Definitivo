import type { IStorage } from "./storage";
import type { CachedGpsEvent, CachedAccEvent } from "@shared/schema";

export interface OrnitelaImportResult {
  gpsImported: number;
  accImported: number;
  gpsDuplicates: number;
  accDuplicates: number;
  errors: number;
  details: string[];
  dataType: string;
  individuals: number;
  individuals_created: number;
  ornitela_subformat: string;
  gpsRows: number;
  sensorsRows: number;
  isV2: boolean;
}

function parseCsvLine(line: string, separator: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === separator) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function safeFloat(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

export async function parseOrnitelaCsv(
  csvContent: string,
  studyId: string,
  storage: IStorage
): Promise<OrnitelaImportResult> {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      gpsImported: 0, accImported: 0, gpsDuplicates: 0, accDuplicates: 0,
      errors: 0, details: ["CSV vacío o sin datos"], dataType: "none",
      individuals: 0, individuals_created: 0, ornitela_subformat: "unknown",
      gpsRows: 0, sensorsRows: 0, isV2: false,
    };
  }

  const hasSemicolon = lines[0].includes(";");
  const separator = hasSemicolon ? ";" : ",";
  const headerVals = parseCsvLine(lines[0], separator);
  const headersLower = headerVals.map((h) => h.trim().toLowerCase());

  const colMap: Record<string, number> = {};
  headersLower.forEach((h, i) => { colMap[h] = i; });

  const findCol = (...names: string[]): number => {
    for (const n of names) {
      if (colMap[n] !== undefined) return colMap[n];
    }
    return -1;
  };

  const v1DeviceId = "device_id";
  const v1Datetime = "utc_datetime";
  const v1Lat = "latitude";
  const v1Lon = "longitude";
  const v1Alt = "altitude_m";
  const v1Speed = "speed_km_h";
  const v1Dir = "direction_deg";
  const v1AccX = "acc_x";
  const v1AccY = "acc_y";
  const v1AccZ = "acc_z";

  const deviceIdCol = findCol(v1DeviceId, "deviceid", "dev_id", "tagid", "tag_id");
  const utcDatetimeCol = findCol(v1Datetime, "datetime_utc", "datetime", "date_time");
  const utcDateCol = findCol("utc_date", "date");
  const utcTimeCol = findCol("utc_time", "time");
  const useSeparateDatetime = utcDatetimeCol === -1 && utcDateCol >= 0 && utcTimeCol >= 0;
  const latCol = findCol(v1Lat, "lat", "location_lat");
  const lonCol = findCol(v1Lon, "lon", "lng", "location_lon", "location_long");
  const altCol = findCol(v1Alt, "altitude", "alt", "height_m", "height");
  const speedKmhCol = findCol(v1Speed, "speed", "speed_kmh", "velocity_km_h");
  const dirCol = findCol(v1Dir, "direction", "heading", "heading_deg", "course");
  const accXCol = findCol(v1AccX, "acceleration_x", "accel_x", "x_acceleration");
  const accYCol = findCol(v1AccY, "acceleration_y", "accel_y", "y_acceleration");
  const accZCol = findCol(v1AccZ, "acceleration_z", "accel_z", "z_acceleration");

  if (deviceIdCol === -1) {
    throw new Error("Formato Ornitela: columna obligatoria 'device_id' (o equivalente) no encontrada");
  }
  if (utcDatetimeCol === -1 && !useSeparateDatetime) {
    throw new Error("Formato Ornitela: columna obligatoria 'UTC_datetime' (o equivalente como utc_date+utc_time) no encontrada");
  }

  const v1Names = new Set([v1DeviceId, v1Datetime, v1Lat, v1Lon, v1Alt, v1Speed, v1Dir, v1AccX, v1AccY, v1AccZ]);
  const allResolvedCols = [deviceIdCol, utcDatetimeCol, utcDateCol, utcTimeCol, latCol, lonCol, altCol, speedKmhCol, dirCol, accXCol, accYCol, accZCol];
  const matchedHeaders = allResolvedCols.filter((c) => c >= 0).map((c) => headersLower[c]);
  const isV2 = matchedHeaders.some((h) => !v1Names.has(h));

  const hasLatLon = latCol >= 0 && lonCol >= 0;
  const hasAccCols = accXCol >= 0 && accYCol >= 0 && accZCol >= 0;

  let subType: string;
  if (hasLatLon && hasAccCols) subType = "gps_sensors";
  else if (hasLatLon) subType = "gps";
  else if (hasAccCols) subType = "sensors";
  else throw new Error("Formato Ornitela: no se encontraron columnas de GPS (Latitude/Longitude) ni de acelerómetro (acc_x/acc_y/acc_z)");

  const detectedSubFormat = `ornitela_${subType}${isV2 ? "_v2" : ""}`;

  let gpsImported = 0, gpsDuplicates = 0, accImported = 0, accDuplicates = 0, errors = 0;
  let gpsRows = 0, sensorsRows = 0;
  const details: string[] = [];
  const individualsSet = new Set<string>();
  const batchSize = 1000;
  let gpsBatch: Omit<CachedGpsEvent, "id">[] = [];
  let accBatch: Omit<CachedAccEvent, "id">[] = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const vals = parseCsvLine(lines[i], separator);
      const deviceId = vals[deviceIdCol]?.trim();

      let utcDatetime: string;
      if (useSeparateDatetime) {
        const datePart = vals[utcDateCol]?.trim();
        const timePart = vals[utcTimeCol]?.trim();
        if (!datePart || !timePart) {
          errors++;
          if (errors <= 10) details.push(`Fila ${i + 1}: utc_date o utc_time vacío`);
          continue;
        }
        utcDatetime = `${datePart} ${timePart}`;
      } else {
        utcDatetime = vals[utcDatetimeCol]?.trim() || "";
      }

      if (!deviceId || !utcDatetime) {
        errors++;
        if (errors <= 10) details.push(`Fila ${i + 1}: device_id o datetime vacío`);
        continue;
      }

      const ts = new Date(utcDatetime.replace(" ", "T") + "Z").getTime();
      if (isNaN(ts)) {
        errors++;
        if (errors <= 10) details.push(`Fila ${i + 1}: fecha/hora inválida "${utcDatetime}"`);
        continue;
      }

      const individual = String(deviceId);

      let rowHasGps = false;
      let rowHasAcc = false;

      if (hasLatLon) {
        const lat = parseFloat(vals[latCol]);
        const lon = parseFloat(vals[lonCol]);
        if (!isNaN(lat) && !isNaN(lon) && !(lat === 0 && lon === 0)) {
          rowHasGps = true;
          gpsRows++;
          const speedKmh = speedKmhCol >= 0 ? safeFloat(vals[speedKmhCol]) : null;
          const speedMs = speedKmh !== null ? speedKmh / 3.6 : null;
          gpsBatch.push({
            studyId,
            individualLocalIdentifier: individual,
            timestamp: ts,
            latitude: lat,
            longitude: lon,
            groundSpeed: speedMs,
            heading: dirCol >= 0 ? safeFloat(vals[dirCol]) : null,
            heightAboveEllipsoid: altCol >= 0 ? safeFloat(vals[altCol]) : null,
          });
        }
      }

      if (hasAccCols) {
        const ax = parseFloat(vals[accXCol]);
        const ay = parseFloat(vals[accYCol]);
        const az = parseFloat(vals[accZCol]);
        if (!isNaN(ax) && !isNaN(ay) && !isNaN(az)) {
          rowHasAcc = true;
          sensorsRows++;
          accBatch.push({
            studyId,
            individualLocalIdentifier: individual,
            timestamp: ts,
            xAcceleration: ax,
            yAcceleration: ay,
            zAcceleration: az,
            rawData: null,
          });
        }
      }

      if (!rowHasGps && !rowHasAcc) {
        errors++;
        if (errors <= 10) details.push(`Fila ${i + 1}: sin datos GPS ni acelerómetro válidos — omitida`);
        continue;
      }

      individualsSet.add(individual);

      if (gpsBatch.length >= batchSize) {
        const r = await storage.insertCachedGpsEventsCounted(gpsBatch);
        gpsImported += r.inserted;
        gpsDuplicates += r.duplicates;
        gpsBatch = [];
      }
      if (accBatch.length >= batchSize) {
        const r = await storage.insertCachedAccEventsCounted(accBatch);
        accImported += r.inserted;
        accDuplicates += r.duplicates;
        accBatch = [];
      }
    } catch (e: any) {
      errors++;
      if (errors <= 10) details.push(`Fila ${i + 1}: ${e.message}`);
    }
  }

  if (gpsBatch.length > 0) {
    const r = await storage.insertCachedGpsEventsCounted(gpsBatch);
    gpsImported += r.inserted;
    gpsDuplicates += r.duplicates;
  }
  if (accBatch.length > 0) {
    const r = await storage.insertCachedAccEventsCounted(accBatch);
    accImported += r.inserted;
    accDuplicates += r.duplicates;
  }

  const imeisList = Array.from(individualsSet);
  const metadataEntries = imeisList.map((name) => ({ name }));
  await storage.createIndividualsWithMetadata(studyId, metadataEntries);
  const linkResult = await storage.upsertOrnitelaDeploymentsForIndividuals(studyId, imeisList);
  details.push(
    `Vinculación Ornitela: ${linkResult.deploymentsCreated} deployments nuevos, ${linkResult.individualsMarkedSynced} individuos marcados como sincronizados`
  );

  let reportedDataType: string;
  if (gpsImported > 0 && accImported > 0) reportedDataType = "gps+acc";
  else if (gpsImported > 0) reportedDataType = "gps";
  else if (accImported > 0) reportedDataType = "acc";
  else reportedDataType = "gps+acc";

  return {
    gpsImported, accImported, gpsDuplicates, accDuplicates,
    errors, details, dataType: reportedDataType,
    individuals: individualsSet.size,
    individuals_created: metadataEntries.length,
    ornitela_subformat: detectedSubFormat,
    gpsRows, sensorsRows, isV2,
  };
}
