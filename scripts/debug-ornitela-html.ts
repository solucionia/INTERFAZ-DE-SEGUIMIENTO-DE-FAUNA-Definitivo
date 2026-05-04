import crypto from "crypto";
import { Client } from "pg";
import * as fs from "fs";

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

async function main() {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const r = await pg.query(`SELECT ornitela_panel_url, ornitela_username, ornitela_password FROM studies WHERE id=$1`, [STUDY_ID]);
  const s = r.rows[0];
  const panelUrl = s.ornitela_panel_url;
  const username = decrypt(s.ornitela_username, key);
  const password = decrypt(s.ornitela_password, key);
  await pg.end();

  console.log(`POST ${panelUrl}/post.php (login)`);
  const loginRes = await fetch(`${panelUrl}/post.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ usr: username, psw: password, login: "Login" }).toString(),
    redirect: "manual",
  });
  console.log(`login status=${loginRes.status}`);
  const setCookie = loginRes.headers.get("set-cookie") || "";
  console.log(`set-cookie: ${setCookie}`);
  const m = setCookie.match(/glo_sessid=([^;]+)/);
  if (!m) throw new Error("No cookie");
  const cookie = `glo_sessid=${m[1]}`;

  console.log(`\nGET ${panelUrl} (device list)`);
  const listRes = await fetch(panelUrl, { headers: { Cookie: cookie } });
  console.log(`list status=${listRes.status}`);
  const html = await listRes.text();
  console.log(`html bytes=${html.length}`);
  fs.writeFileSync("/tmp/ornitela-list.html", html);
  console.log(`saved to /tmp/ornitela-list.html`);

  const hasDtIndex = html.includes("dt_index");
  const hasLogin = /password|usr.*psw/i.test(html.slice(0, 5000));
  console.log(`contains 'dt_index': ${hasDtIndex}`);
  console.log(`looks like login page: ${hasLogin}`);
  console.log(`title:`, (html.match(/<title>([^<]*)<\/title>/i) || [])[1]);

  const tableMatches = html.match(/<table[^>]*id=["'][^"']*["'][^>]*>/gi) || [];
  console.log(`tables with ids:`, tableMatches.slice(0, 10));

  const trCount = (html.match(/<tr[\s>]/gi) || []).length;
  console.log(`<tr> count: ${trCount}`);

  console.log(`\nfirst 800 chars:\n${html.slice(0, 800)}`);
  console.log(`\nlast 400 chars:\n${html.slice(-400)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
