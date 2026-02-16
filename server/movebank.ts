import { log } from "./index";

const MOVEBANK_BASE = "https://www.movebank.org/movebank/service/direct-read";
const MOVEBANK_TIMEOUT_MS = 60000;

export class MovebankError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "MovebankError";
    this.statusCode = statusCode;
  }
}

async function handleMovebankResponse(res: Response, context: string): Promise<string> {
  log(`Movebank HTTP ${res.status} ${res.statusText} para: ${context}`, "movebank");

  const body = await res.text();

  if (res.ok) {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      log(`Movebank devolvió HTML en vez de CSV (posible página de términos de licencia): ${body.substring(0, 500)}`, "movebank");
      if (body.includes("License Terms") || body.includes("license-md5")) {
        throw new MovebankError("Movebank requiere aceptar los términos de licencia del estudio. Contacte al administrador.", 403);
      }
      throw new MovebankError(`Movebank devolvió HTML inesperado en vez de datos CSV`, 502);
    }
    return body;
  }

  log(`Movebank error body: ${body.substring(0, 500)}`, "movebank");

  const status = res.status;
  if (status === 401) {
    throw new MovebankError("Credenciales de Movebank inválidas para este estudio", 401);
  } else if (status === 403) {
    throw new MovebankError("No tiene permisos para acceder a este estudio en Movebank", 403);
  } else if (status === 429) {
    throw new MovebankError("Movebank ha limitado las peticiones temporalmente. Intente de nuevo en unos minutos.", 429);
  } else {
    throw new MovebankError(`Error al conectar con Movebank: ${status} ${res.statusText}`, status);
  }
}

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

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MOVEBANK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new MovebankError("Movebank no respondió a tiempo. Intente de nuevo", 408);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMovebankIndividuals(
  studyId: number,
  username: string,
  password: string
): Promise<Record<string, string>[]> {
  const url = `${MOVEBANK_BASE}?entity_type=individual&study_id=${studyId}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    const text = await handleMovebankResponse(res, `individuals for study ${studyId}`);
    return parseCSV(text);
  } catch (e: any) {
    log(`Movebank fetch error (individuals, study ${studyId}): ${e.message}`, "movebank");
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
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    const text = await handleMovebankResponse(res, `events for ${individualLocalIdentifier}`);
    return parseCSV(text);
  } catch (e: any) {
    log(`Movebank fetch error (events, ${individualLocalIdentifier}): ${e.message}`, "movebank");
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
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    const text = await handleMovebankResponse(res, `deployments for study ${studyId}`);
    return parseCSV(text);
  } catch (e: any) {
    log(`Movebank fetch error (deployments, study ${studyId}): ${e.message}`, "movebank");
    throw e;
  }
}

export async function fetchMovebankDeploymentIndividualMap(
  studyId: number,
  username: string,
  password: string
): Promise<Map<string, { individualId: string; individualLocalIdentifier: string }>> {
  const params = new URLSearchParams({
    entity_type: "event",
    study_id: studyId.toString(),
    sensor_type_id: "653",
    max_events_per_individual: "1",
    attributes: "individual_id,individual_local_identifier,deployment_id",
  });
  const url = `${MOVEBANK_BASE}?${params.toString()}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    const text = await handleMovebankResponse(res, `deployment-individual map for study ${studyId}`);
    const rows = parseCSV(text);

    const map = new Map<string, { individualId: string; individualLocalIdentifier: string }>();
    for (const row of rows) {
      const depId = row.deployment_id;
      if (depId && !map.has(depId)) {
        map.set(depId, {
          individualId: row.individual_id || "",
          individualLocalIdentifier: row.individual_local_identifier || "",
        });
      }
    }
    log(`Movebank deployment-individual map: ${map.size} unique deployment→individual mappings from ${rows.length} event rows`, "movebank");
    return map;
  } catch (e: any) {
    log(`Movebank fetch error (deployment-individual map, study ${studyId}): ${e.message}`, "movebank");
    throw e;
  }
}
