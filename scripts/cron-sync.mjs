#!/usr/bin/env node
/**
 * Scheduled Deployment trigger para WildTrack.
 *
 * Llama POST /api/sync-all con cabecera X-Sync-Secret cada 6h
 * para forzar la ejecución de:
 *   - event_detection
 *   - emission_check
 *   - ornitela_sync
 *
 * NOTA: immobility_check NO se ejecuta aquí. Tiene su propio cron dedicado
 * cada 2h (IMMOBILITY_CRON_INTERVAL = "0 *\/2 * * *") con mutex single-flight
 * para evitar emails duplicados de alertas críticas en horas alineadas.
 *
 * Uso (Replit Scheduled Deployment):
 *   - Comando: node scripts/cron-sync.mjs
 *   - Schedule: 0 *\/6 * * *  (cada 6 horas)
 *   - Variables requeridas: SYNC_URL, SYNC_SECRET
 *
 * SYNC_URL ejemplo: https://wildtrack.replit.app/api/sync-all
 */

const SYNC_URL = process.env.SYNC_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;

if (!SYNC_URL) {
  console.error("[cron-sync] ERROR: SYNC_URL no configurada");
  process.exit(1);
}
if (!SYNC_SECRET) {
  console.error("[cron-sync] ERROR: SYNC_SECRET no configurada");
  process.exit(1);
}

const startedAt = new Date().toISOString();
console.log(`[cron-sync] ${startedAt} → POST ${SYNC_URL}`);

try {
  const controller = new AbortController();
  const timeoutMs = 25 * 60 * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(SYNC_URL, {
    method: "POST",
    headers: {
      "X-Sync-Secret": SYNC_SECRET,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: controller.signal,
  });
  clearTimeout(timer);

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!res.ok) {
    console.error(`[cron-sync] HTTP ${res.status}:`, body);
    process.exit(2);
  }

  console.log(`[cron-sync] OK (${res.status}) en ${body.totalSeconds ?? "?"}s`);
  if (body.tasks) {
    for (const [name, info] of Object.entries(body.tasks)) {
      const status = info.ok ? "OK" : "FAIL";
      console.log(`  - ${name}: ${status} (${info.durationSeconds}s)${info.error ? ` — ${info.error}` : ""}${info.logDetails ? ` — ${info.logDetails}` : ""}`);
    }
  }
  process.exit(0);
} catch (err) {
  console.error("[cron-sync] ERROR:", err?.message || err);
  process.exit(3);
}
