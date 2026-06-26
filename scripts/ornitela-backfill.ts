/**
 * One-off historical backfill for the main Ornitela study.
 *
 * Replicates the logic of POST /api/studies/:id/ornitela-sync but runs as a
 * standalone process (no auth, no 50-device batch cap) so it can pull a long
 * historical window in the background.
 *
 * Usage:
 *   WILDTRACK_NO_BOOT=1 tsx scripts/ornitela-backfill.ts            # full backfill
 *   WILDTRACK_NO_BOOT=1 VERIFY=1 tsx scripts/ornitela-backfill.ts   # connectivity check only
 *
 * Env overrides: STUDY_ID, HOURS_BACK
 */
import { storage } from "../server/storage";
import { ornitelaSync } from "../server/ornitelaSync";
import { parseOrnitelaCsv } from "../server/ornitelaCsvParser";
import { initEncryption } from "../server/encryption";

const STUDY_ID = process.env.STUDY_ID || "707cdf23-9e59-4095-bb98-4f2b832f896e";
const HOURS_BACK = Number(process.env.HOURS_BACK) || 8760; // 1 año
const END_HOURS_BACK = Number(process.env.END_HOURS_BACK) || 0; // fin de ventana (0 = ahora)
const DEVICE_DELAY_MS = 1500;
const RELOGIN_EVERY = 40; // re-login periódico para sesiones largas
const VERIFY_ONLY = process.env.VERIFY === "1";
const START_INDEX = Number(process.env.START_INDEX) || 0;
const MAX_DEVICES = Number(process.env.MAX_DEVICES) || 0; // 0 = todos
const DEVICE_IMEI = process.env.DEVICE_IMEI || ""; // si se indica, sólo ese dispositivo

function fmtDt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function ts(): string {
  return new Date().toISOString();
}

const MIN_SPLIT_HOURS = 6; // no subdividir ventanas por debajo de 6h
const isOversizeError = (msg: string) =>
  /string longer than|Invalid string length|heap out of memory|allocation failed/i.test(msg);

async function main() {
  if (
    !Number.isFinite(HOURS_BACK) ||
    !Number.isFinite(END_HOURS_BACK) ||
    HOURS_BACK <= 0 ||
    END_HOURS_BACK < 0 ||
    HOURS_BACK <= END_HOURS_BACK
  ) {
    throw new Error(
      `Ventana inválida: HOURS_BACK=${HOURS_BACK}, END_HOURS_BACK=${END_HOURS_BACK} (se requiere HOURS_BACK > END_HOURS_BACK >= 0)`,
    );
  }

  initEncryption();

  const study = await storage.getStudyDecrypted(STUDY_ID);
  if (!study) throw new Error(`Estudio ${STUDY_ID} no encontrado`);
  if (!study.ornitelaUsername || !study.ornitelaPassword) {
    throw new Error("Credenciales de Ornitela no configuradas");
  }
  const panelUrl = study.ornitelaPanelUrl || "https://cpanel.glosendas.net";

  const now = new Date();
  const fromStr = fmtDt(new Date(now.getTime() - HOURS_BACK * 60 * 60 * 1000));
  const toStr = fmtDt(new Date(now.getTime() - END_HOURS_BACK * 60 * 60 * 1000));

  console.log(`[${ts()}] Estudio: "${study.name}" (${STUDY_ID})`);
  console.log(`[${ts()}] Panel: ${panelUrl}`);
  console.log(`[${ts()}] Ventana: ${fromStr} → ${toStr} (${HOURS_BACK}h)`);
  console.log(`[${ts()}] Login...`);

  let session = await ornitelaSync.login(panelUrl, study.ornitelaUsername, study.ornitelaPassword);
  console.log(`[${ts()}] Login OK. Obteniendo lista de dispositivos...`);

  let devices = await ornitelaSync.getDeviceList(panelUrl, session);
  console.log(`[${ts()}] Dispositivos encontrados: ${devices.length}`);

  if (DEVICE_IMEI) {
    devices = devices.filter((d) => d.imei === DEVICE_IMEI);
    console.log(`[${ts()}] Filtro DEVICE_IMEI=${DEVICE_IMEI} → ${devices.length} dispositivo(s)`);
  }

  if (VERIFY_ONLY) {
    const probe = devices[0];
    if (probe) {
      const probeFrom = fmtDt(new Date(now.getTime() - 60 * 60 * 1000));
      console.log(`[${ts()}] VERIFY: descargando 1h de ${probe.name} (${probe.imei})...`);
      const csv = await ornitelaSync.downloadCSV(panelUrl, session, probe.imei, probeFrom, toStr);
      console.log(`[${ts()}] VERIFY OK: CSV ${csv ? csv.length : 0} bytes para ${probe.name}`);
    }
    console.log(`[${ts()}] VERIFY completado. Panel responde correctamente.`);
    return;
  }

  const endIndex = MAX_DEVICES > 0 ? Math.min(START_INDEX + MAX_DEVICES, devices.length) : devices.length;
  const slice = devices.slice(START_INDEX, endIndex);
  const hasMore = endIndex < devices.length;
  console.log(`[${ts()}] Procesando dispositivos ${START_INDEX}..${endIndex - 1} de ${devices.length} (${slice.length} en este lote)`);

  let processed = 0;
  let totalGps = 0;
  let totalAcc = 0;
  let totalGpsDup = 0;
  let totalAccDup = 0;
  let totalErrors = 0;
  let deviceErrors = 0;
  let emptyDevices = 0;

  type WinResult = { gps: number; acc: number; gpsDup: number; accDup: number; errors: number };

  // Descarga+parseo de una ventana [fromHb, toHb] horas atrás. Si el CSV es
  // demasiado grande para Node (límite de string ~512MB), subdivide la ventana
  // por la mitad y reintenta cada mitad, hasta MIN_SPLIT_HOURS.
  async function fetchWindow(
    device: { imei: string; name: string },
    fromHb: number,
    toHb: number,
  ): Promise<WinResult> {
    const f = fmtDt(new Date(now.getTime() - fromHb * 60 * 60 * 1000));
    const t = fmtDt(new Date(now.getTime() - toHb * 60 * 60 * 1000));
    try {
      const csv = await ornitelaSync.downloadCSV(panelUrl, session, device.imei, f, t);
      if (!csv || csv.trim().length < 10) {
        return { gps: 0, acc: 0, gpsDup: 0, accDup: 0, errors: 0 };
      }
      const r = await parseOrnitelaCsv(csv, STUDY_ID, storage, { ornitelaName: device.name });
      return {
        gps: r.gpsImported,
        acc: r.accImported,
        gpsDup: r.gpsDuplicates,
        accDup: r.accDuplicates,
        errors: r.errors,
      };
    } catch (err: any) {
      if (isOversizeError(err?.message || "") && fromHb - toHb > MIN_SPLIT_HOURS) {
        const mid = Math.floor((fromHb + toHb) / 2);
        console.log(
          `[${ts()}] ${device.name} (${device.imei}): ventana ${fromHb}-${toHb}h demasiado grande, ` +
          `subdividiendo en ${fromHb}-${mid}h y ${mid}-${toHb}h`,
        );
        const a = await fetchWindow(device, fromHb, mid);
        await new Promise((r) => setTimeout(r, 500));
        const b = await fetchWindow(device, mid, toHb);
        return {
          gps: a.gps + b.gps,
          acc: a.acc + b.acc,
          gpsDup: a.gpsDup + b.gpsDup,
          accDup: a.accDup + b.accDup,
          errors: a.errors + b.errors,
        };
      }
      throw err;
    }
  }

  for (let i = 0; i < slice.length; i++) {
    const device = slice[i];
    const globalIdx = START_INDEX + i;
    if (i > 0) await new Promise((r) => setTimeout(r, DEVICE_DELAY_MS));

    if (i > 0 && i % RELOGIN_EVERY === 0) {
      try {
        session = await ornitelaSync.login(panelUrl, study.ornitelaUsername, study.ornitelaPassword);
        console.log(`[${ts()}] Re-login OK (dispositivo ${i}/${devices.length})`);
      } catch (e: any) {
        console.log(`[${ts()}] Re-login falló: ${e.message} (continúo con sesión actual)`);
      }
    }

    let attempt = 0;
    while (attempt < 2) {
      attempt++;
      try {
        const r = await fetchWindow(device, HOURS_BACK, END_HOURS_BACK);
        if (r.gps === 0 && r.acc === 0 && r.gpsDup === 0 && r.accDup === 0 && r.errors === 0) {
          emptyDevices++;
          console.log(`[${ts()}] [${globalIdx + 1}/${devices.length}] ${device.name} (${device.imei}): CSV vacío / sin datos`);
          break;
        }
        totalGps += r.gps;
        totalAcc += r.acc;
        totalGpsDup += r.gpsDup;
        totalAccDup += r.accDup;
        totalErrors += r.errors;
        console.log(
          `[${ts()}] [${globalIdx + 1}/${devices.length}] ${device.name} (${device.imei}): ` +
          `GPS +${r.gps} (dup ${r.gpsDup}), ACC +${r.acc} (dup ${r.accDup})` +
          ` | acum GPS ${totalGps} ACC ${totalAcc}`,
        );
        break;
      } catch (err: any) {
        if (attempt < 2) {
          console.log(`[${ts()}] [${globalIdx + 1}/${devices.length}] ${device.name}: error "${err.message}" — re-login y reintento`);
          try {
            session = await ornitelaSync.login(panelUrl, study.ornitelaUsername, study.ornitelaPassword);
          } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          deviceErrors++;
          console.log(`[${ts()}] [${globalIdx + 1}/${devices.length}] ${device.name} (${device.imei}): ERROR ${err.message}`);
        }
      }
    }
    processed++;
  }

  await storage.updateStudy(STUDY_ID, { ornitelaLastSync: new Date() } as any);

  console.log(`\n[${ts()}] ===== LOTE COMPLETADO =====`);
  console.log(`Dispositivos procesados: ${processed} (rango ${START_INDEX}..${endIndex - 1} de ${devices.length})`);
  console.log(`GPS importados: ${totalGps} (duplicados ${totalGpsDup})`);
  console.log(`ACC importados: ${totalAcc} (duplicados ${totalAccDup})`);
  console.log(`Dispositivos sin datos: ${emptyDevices}`);
  console.log(`Errores de dispositivo: ${deviceErrors} | errores de parseo: ${totalErrors}`);
  if (hasMore) {
    console.log(`NEXT_START_INDEX=${endIndex} (quedan ${devices.length - endIndex} dispositivos)`);
  } else {
    console.log(`NEXT_START_INDEX=DONE (no quedan más dispositivos)`);
  }
}

main()
  .then(async () => {
    console.log(`[${ts()}] Script finalizado correctamente.`);
    if (process.env.KEEP_ALIVE === "1") {
      console.log(`[${ts()}] KEEP_ALIVE=1 — proceso en espera (puede detenerse el workflow).`);
      await new Promise(() => {});
      return;
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[${ts()}] FALLO FATAL: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  });
