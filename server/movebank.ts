import { log } from "./index";

const MOVEBANK_BASE = "https://www.movebank.org/movebank/service/direct-read";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
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
      } else if (ch === ',') {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    rows.push(row);
  }
  return rows;
}

export async function fetchMovebankIndividuals(
  studyId: number,
  username: string,
  password: string
): Promise<Record<string, string>[]> {
  const url = `${MOVEBANK_BASE}?entity_type=individual&study_id=${studyId}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) {
      const text = await res.text();
      log(`Movebank individuals error ${res.status}: ${text}`, "movebank");
      throw new Error(`Movebank API error: ${res.status}`);
    }

    const text = await res.text();
    return parseCSV(text);
  } catch (e: any) {
    log(`Movebank fetch error: ${e.message}`, "movebank");
    throw e;
  }
}

export async function fetchMovebankEvents(
  studyId: number,
  username: string,
  password: string,
  individualLocalIdentifier: string,
  sensorTypeId: number,
  timestampStart: number,
  timestampEnd: number
): Promise<Record<string, string>[]> {
  const params = new URLSearchParams({
    entity_type: "event",
    study_id: studyId.toString(),
    individual_local_identifier: individualLocalIdentifier,
    sensor_type_id: sensorTypeId.toString(),
    timestamp_start: timestampStart.toString(),
    timestamp_end: timestampEnd.toString(),
  });
  const url = `${MOVEBANK_BASE}?${params.toString()}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) {
      const text = await res.text();
      log(`Movebank events error ${res.status}: ${text}`, "movebank");
      throw new Error(`Movebank API error: ${res.status}`);
    }

    const text = await res.text();
    return parseCSV(text);
  } catch (e: any) {
    log(`Movebank events fetch error: ${e.message}`, "movebank");
    throw e;
  }
}

export async function fetchMovebankDeployments(
  studyId: number,
  username: string,
  password: string
): Promise<Record<string, string>[]> {
  const url = `${MOVEBANK_BASE}?entity_type=deployment&study_id=${studyId}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) {
      const text = await res.text();
      log(`Movebank deployments error ${res.status}: ${text}`, "movebank");
      throw new Error(`Movebank API error: ${res.status}`);
    }

    const text = await res.text();
    return parseCSV(text);
  } catch (e: any) {
    log(`Movebank fetch error: ${e.message}`, "movebank");
    throw e;
  }
}
