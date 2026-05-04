import * as cheerio from "cheerio";
import crypto from "crypto";
import { Client } from "pg";

const STUDY_ID = "707cdf23-9e59-4095-bb98-4f2b832f896e";

function decrypt(payload: string, key: Buffer): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(dataHex, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

async function ornitelaLogin(panelUrl: string, username: string, password: string): Promise<string> {
  const formData = new URLSearchParams();
  formData.append("username", username);
  formData.append("password", password);
  formData.append("login", "Login");
  formData.append("resx", "800");
  formData.append("resy", "1716");
  formData.append("resax", "2008");
  formData.append("resay", "4308");
  formData.append("reso", "-90");

  const res = await fetch(`${panelUrl}/post.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
    redirect: "manual",
  });
  const setCookieHeaders = (res.headers as any).getSetCookie
    ? (res.headers as any).getSetCookie()
    : (res.headers.get("set-cookie") || "").split(",").filter(Boolean);
  for (const c of setCookieHeaders) {
    const m = c.match(/glo_sessid=([^;]+)/);
    if (m) return `glo_sessid=${m[1]}`;
  }
  throw new Error(`Login falló — no se obtuvo cookie. status=${res.status}`);
}

async function getDeviceList(panelUrl: string, cookie: string) {
  const res = await fetch(panelUrl, { method: "GET", headers: { Cookie: cookie } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const devices: { name: string; serial: string; status: string; lastGPRS: string; imei: string }[] = [];

  $("#dt_index tbody tr, #dt_index tr").each((_index, row) => {
    const cells = $(row).find("td, th");
    if (cells.length < 4) return;
    let imei = "";
    const onClick = $(row).attr("onclick") || $(row).attr("onClick") || "";
    const wrMatch = onClick.match(/WR\s*\(\s*'(\d{10,20})'/);
    if (wrMatch) imei = wrMatch[1];
    if (!imei) {
      const firstCell = cells.eq(0).text().trim();
      if (/^\d{10,20}$/.test(firstCell)) imei = firstCell;
    }
    if (!imei) {
      const rowHtml = $(row).html() || "";
      const dlMatch = rowHtml.match(/dl(\d{10,20})cc/);
      if (dlMatch) imei = dlMatch[1];
    }
    if (!imei) return;

    let name = "", serial = "", status = "", lastGPRS = "";
    cells.each((_i, cell) => {
      const el = $(cell);
      const dataOrder = el.attr("data-order") || "";
      const text = el.text().trim();
      if (!name && el.hasClass("tcl") && text.length > 2 && !/^\d+$/.test(text) && !text.includes("Loading")) name = text;
      if (!serial && /^\d{4,8}$/.test(dataOrder) && /^\d{4,8}$/.test(text)) serial = text;
      if (!lastGPRS && /^\d{4}-\d{2}-\d{2}/.test(dataOrder)) lastGPRS = text;
      if (!status) {
        const img = el.find("img[title]");
        if (img.length > 0) {
          const title = img.attr("title") || "";
          if (title.includes("suspended")) status = "suspended";
          else if (title.includes("active") || title.includes("transmitting")) status = "active";
        }
      }
    });
    if (!name) {
      const nameSpan = $(row).find("span[id^='tdn_']");
      if (nameSpan.length > 0) name = nameSpan.text().trim();
    }
    if (!serial) {
      const snEl = $(row).find("th[data-order] b, td[data-order] b");
      if (snEl.length > 0) serial = snEl.first().text().trim();
    }
    devices.push({ name: name || `Device-${imei.slice(-6)}`, serial, status: status || "unknown", lastGPRS, imei });
  });
  return devices;
}

async function main() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) throw new Error("ENCRYPTION_KEY no definida");
  const key = Buffer.from(envKey, "hex");

  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  const studyRes = await pg.query(
    `SELECT name, ornitela_panel_url, ornitela_username, ornitela_password FROM studies WHERE id=$1`,
    [STUDY_ID]
  );
  if (studyRes.rowCount === 0) throw new Error("Estudio no encontrado");
  const s = studyRes.rows[0];

  const panelUrl: string = s.ornitela_panel_url;
  const username = decrypt(s.ornitela_username, key);
  const password = decrypt(s.ornitela_password, key);

  console.log(`\n[1/4] Login en ${panelUrl} ...`);
  const cookie = await ornitelaLogin(panelUrl, username, password);
  console.log(`    -> cookie OK`);

  console.log(`[2/4] Descargando lista de dispositivos ...`);
  const devices = await getDeviceList(panelUrl, cookie);
  console.log(`    -> ${devices.length} dispositivos en el panel`);

  console.log(`[3/4] Cargando individuos del estudio "${s.name}" ...`);
  const indivRes = await pg.query(
    `SELECT local_identifier, nick_name, synced FROM individuals WHERE study_id=$1`,
    [STUDY_ID]
  );
  console.log(`    -> ${indivRes.rowCount} individuos en BD`);

  console.log(`[4/4] Comparando ...\n`);

  const indivIds = new Set(indivRes.rows.map((r) => String(r.local_identifier ?? "").trim()).filter(Boolean));

  const lookups = devices.map((d) => {
    const imei = String(d.imei).trim();
    const serial = String(d.serial ?? "").trim();
    const name = String(d.name ?? "").trim();
    const matchedBy =
      indivIds.has(imei) ? "imei" :
      indivIds.has(serial) ? "serial" :
      indivIds.has(name) ? "name" :
      indivIds.has(imei.slice(-6)) ? "imei_last6" :
      null;
    return { imei, serial, name, status: d.status, lastGPRS: d.lastGPRS, matchedBy };
  });

  const matched = lookups.filter((l) => l.matchedBy !== null);
  const missing = lookups.filter((l) => l.matchedBy === null);

  const matchedByType: Record<string, number> = {};
  for (const m of matched) matchedByType[m.matchedBy!] = (matchedByType[m.matchedBy!] || 0) + 1;

  console.log(`Total dispositivos panel    : ${devices.length}`);
  console.log(`Total individuos en BD      : ${indivRes.rowCount}`);
  console.log(`Dispositivos coincidentes   : ${matched.length}  ${JSON.stringify(matchedByType)}`);
  console.log(`Dispositivos NO importados  : ${missing.length}`);

  if (missing.length > 0) {
    console.log(`\n=== DISPOSITIVOS QUE FALTAN COMO INDIVIDUOS (${missing.length}) ===`);
    console.log("name | serial | imei | status | lastGPRS");
    console.log("-".repeat(90));
    for (const m of missing) {
      console.log(`${m.name} | ${m.serial} | ${m.imei} | ${m.status} | ${m.lastGPRS}`);
    }
    const byStatus: Record<string, number> = {};
    for (const m of missing) byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    console.log(`\nResumen por status: ${JSON.stringify(byStatus)}`);
  }

  const indivIdsList = Array.from(indivIds);
  const deviceKeysAll = new Set<string>();
  for (const l of lookups) {
    deviceKeysAll.add(l.imei);
    if (l.serial) deviceKeysAll.add(l.serial);
    if (l.name) deviceKeysAll.add(l.name);
    deviceKeysAll.add(l.imei.slice(-6));
  }
  const orphanIndividuals = indivIdsList.filter((id) => !deviceKeysAll.has(id));
  if (orphanIndividuals.length > 0) {
    console.log(`\n=== INDIVIDUOS SIN DISPOSITIVO EN PANEL (${orphanIndividuals.length}) ===`);
    console.log(orphanIndividuals.slice(0, 50).join(", "));
  }

  await pg.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
