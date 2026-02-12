import { log } from "./index";

const MOVEBANK_BASE = "https://www.movebank.org/movebank/service/direct-read";

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/"/g, ""));
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
