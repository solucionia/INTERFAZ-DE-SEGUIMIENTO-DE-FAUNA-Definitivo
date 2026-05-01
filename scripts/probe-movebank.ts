import { initEncryption } from "../server/encryption";
import { storage } from "../server/storage";

function fmtMovebank(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    p(d.getUTCMilliseconds(), 3)
  );
}

async function main() {
  initEncryption();
  const study = await storage.getStudyDecrypted("0b9903f3-5b13-4bca-bfb7-b13bfc117320");
  if (!study) throw new Error("study not found");
  const u = study.movebankUsername!;
  const p = study.movebankPassword!;
  const studyMbId = study.movebankStudyId!;

  const auth = "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

  async function probe(label: string, url: string) {
    const r = await fetch(url, { headers: { Authorization: auth } });
    const ct = r.headers.get("content-type") || "";
    const body = await r.text();
    console.log(`\n=== ${label} ===`);
    console.log("status:", r.status, "content-type:", ct, "bodyLen:", body.length);
    console.log(body.substring(0, 1200));
    console.log("---");
  }

  const tEnd = Date.now();
  const t30 = tEnd - 30 * 24 * 60 * 60 * 1000;

  console.log("MS:", t30, "→", tEnd);
  console.log("Movebank fmt:", fmtMovebank(t30), "→", fmtMovebank(tEnd));

  await probe("MAL: BE IT 002 30d con timestamp en ms epoch (BUG actual)",
    `https://www.movebank.org/movebank/service/direct-read?entity_type=event&study_id=${studyMbId}&individual_local_identifier=BE+IT+002&sensor_type_id=653&timestamp_start=${t30}&timestamp_end=${tEnd}`);

  await probe("BIEN: BE IT 002 30d con formato Movebank YYYYMMDDhhmmssSSS",
    `https://www.movebank.org/movebank/service/direct-read?entity_type=event&study_id=${studyMbId}&individual_local_identifier=BE+IT+002&sensor_type_id=653&timestamp_start=${fmtMovebank(t30)}&timestamp_end=${fmtMovebank(tEnd)}`);

  await probe("BIEN sin sensor: BE IT 002 30d formato Movebank",
    `https://www.movebank.org/movebank/service/direct-read?entity_type=event&study_id=${studyMbId}&individual_local_identifier=BE+IT+002&timestamp_start=${fmtMovebank(t30)}&timestamp_end=${fmtMovebank(tEnd)}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
