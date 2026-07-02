import SftpClient from "ssh2-sftp-client";
import { storage } from "../storage";
import { parseOrnitelaCsv, parseCsvLine } from "../ornitelaCsvParser";
import { log } from "../index";

const SFTP_HOST = process.env.ORNITELA_SFTP_HOST || "146.148.12.195";
const SFTP_PORT = parseInt(process.env.ORNITELA_SFTP_PORT || "22", 10);
const SFTP_USER = process.env.ORNITELA_SFTP_USER || "ornitela";
const SFTP_PASSWORD = process.env.ORNITELA_SFTP_PASSWORD || "";
const SFTP_REMOTE_DIR = process.env.ORNITELA_SFTP_REMOTE_DIR || "/uploads";
const SFTP_PROCESSED_DIR = `${SFTP_REMOTE_DIR.replace(/\/$/, "")}/processed`;

const POLL_INTERVAL_MS = parseInt(
  process.env.ORNITELA_SFTP_POLL_MS || `${2 * 60 * 1000}`,
  10,
);
const INITIAL_DELAY_MS = 10 * 1000;
const CONNECT_RETRIES = 3;
const CONNECT_BACKOFF_MS = 5000;
const READY_TIMEOUT_MS = 20 * 1000;
const MAX_RECENT_ERRORS = 10;

export interface SftpRunResult {
  filesScanned: number;
  filesProcessed: number;
  filesSkippedDuplicate: number;
  filesFailed: number;
  recordsImported: number;
  errors: string[];
  globalError: string | null;
}

export interface SftpRecentFile {
  filename: string;
  processedAt: string;
  recordsCount: number;
}

export interface SftpWatcherStatus {
  enabled: boolean;
  running: boolean;
  pollIntervalMs: number;
  host: string;
  port: number;
  user: string;
  remoteDir: string;
  processedDir: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  totalRuns: number;
  totalFilesProcessed: number;
  totalFilesFailed: number;
  totalRecordsImported: number;
  recentErrors: { at: string; message: string }[];
  recentFiles: SftpRecentFile[];
  totalProcessedAllTime: number;
}

class SftpWatcher {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;
  private totalRuns = 0;
  private totalFilesProcessed = 0;
  private totalFilesFailed = 0;
  private totalRecordsImported = 0;
  private recentErrors: { at: number; message: string }[] = [];

  start() {
    if (this.timer || this.bootTimer) return;
    if (!SFTP_PASSWORD) {
      log("SFTP watcher deshabilitado: ORNITELA_SFTP_PASSWORD no configurada", "sftp");
      return;
    }
    if (process.env.ORNITELA_SFTP_DISABLED === "1") {
      log("SFTP watcher deshabilitado por ORNITELA_SFTP_DISABLED=1", "sftp");
      return;
    }
    log(
      `SFTP watcher iniciando — ${SFTP_USER}@${SFTP_HOST}:${SFTP_PORT}${SFTP_REMOTE_DIR}, intervalo ${POLL_INTERVAL_MS}ms`,
      "sftp",
    );
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.tick().catch(() => {});
    }, INITIAL_DELAY_MS);
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
  }

  async tick(): Promise<SftpRunResult | null> {
    if (this.isRunning) return null;
    this.isRunning = true;
    this.lastRunAt = Date.now();
    this.totalRuns++;

    let sftp: SftpClient | null = null;
    const result: SftpRunResult = {
      filesScanned: 0,
      filesProcessed: 0,
      filesSkippedDuplicate: 0,
      filesFailed: 0,
      recordsImported: 0,
      errors: [],
      globalError: null,
    };

    const studiesWithNewData = new Set<string>();

    try {
      sftp = await this.connectWithRetry();

      try {
        const exists = await sftp.exists(SFTP_PROCESSED_DIR);
        if (!exists) await sftp.mkdir(SFTP_PROCESSED_DIR, true);
      } catch (mkErr: any) {
        log(`SFTP: aviso creando ${SFTP_PROCESSED_DIR}: ${mkErr.message}`, "sftp");
      }

      const list = await sftp.list(SFTP_REMOTE_DIR);
      const csvFiles = list.filter(
        (f) => f.type === "-" && /\.csv$/i.test(f.name),
      );
      result.filesScanned = csvFiles.length;

      for (const f of csvFiles) {
        const remotePath = `${SFTP_REMOTE_DIR}/${f.name}`;
        const movedPath = `${SFTP_PROCESSED_DIR}/${f.name}`;
        try {
          const already = await storage.getProcessedSftpFile(f.name);
          if (already) {
            result.filesSkippedDuplicate++;
            try { await sftp.rename(remotePath, movedPath); } catch {}
            continue;
          }

          const buf = (await sftp.get(remotePath)) as Buffer;
          const csv = buf.toString("utf-8");

          const deviceId = extractFirstDeviceId(csv);
          const studyId = deviceId ? await storage.findOrnitelaStudyForDevice(deviceId) : null;
          if (!studyId) {
            // Sin asignación determinista: guardar el archivo (contenido incluido) en la
            // cola de "sin asignar" para que sea visible en la UI y se pueda reprocesar
            // retroactivamente cuando el admin añada el dispositivo a la allowlist.
            const modAt =
              typeof (f as any).modifyTime === "number" ? new Date((f as any).modifyTime) : null;
            await storage.recordUnassignedSftpFile(f.name, deviceId, csv, modAt);
            const msg = `${f.name}: dispositivo "${deviceId ?? "?"}" sin estudio asignado (añádelo a la allowlist del estudio)`;
            this.pushError(msg);
            result.errors.push(msg);
            result.filesFailed++;
            this.totalFilesFailed++;
            log(`SFTP: ${msg}`, "sftp");
            continue;
          }

          const parseResult = await parseOrnitelaCsv(csv, studyId, storage);
          const records = parseResult.gpsImported + parseResult.accImported;
          await storage.recordProcessedSftpFile(f.name, records);
          // Reconciliación: si este archivo estuvo previamente en la cola "sin
          // asignar" (p.ej. el dispositivo ya tiene deployment/allowlist), márcalo
          // resuelto para que no quede como pendiente fantasma en la UI.
          await storage.resolveUnassignedFileByFilename(f.name, studyId);
          if (records > 0) studiesWithNewData.add(studyId);

          try {
            await sftp.rename(remotePath, movedPath);
          } catch (mvErr: any) {
            log(
              `SFTP: ${f.name} importado pero no se pudo mover a /processed: ${mvErr.message}`,
              "sftp",
            );
          }

          result.filesProcessed++;
          result.recordsImported += records;
          this.totalFilesProcessed++;
          this.totalRecordsImported += records;
          log(
            `SFTP: ${f.name} → ${parseResult.gpsImported} GPS, ${parseResult.accImported} ACC, ${parseResult.individuals} individuos (estudio ${studyId})`,
            "sftp",
          );
        } catch (fe: any) {
          const msg = `${f.name}: ${fe.message ?? fe}`;
          this.pushError(msg);
          result.errors.push(msg);
          result.filesFailed++;
          this.totalFilesFailed++;
          log(`SFTP error procesando ${f.name}: ${fe.message ?? fe}`, "sftp");
        }
      }

      this.lastSuccessAt = Date.now();
      if (result.filesFailed === 0) this.lastError = null;
      else this.lastError = result.errors.slice(0, 3).join(" | ");

      if (studiesWithNewData.size > 0) {
        try {
          const { triggerImmobilityAnalysisInBackground } = await import("../immobilityDetector");
          Array.from(studiesWithNewData).forEach((sid) => {
            triggerImmobilityAnalysisInBackground(sid, "sftp-watcher");
          });
          log(
            `SFTP: análisis de inmovilidad disparado para ${studiesWithNewData.size} estudio(s) con datos nuevos`,
            "sftp",
          );
        } catch (trErr: any) {
          log(`SFTP: error disparando análisis: ${trErr?.message ?? trErr}`, "sftp");
        }
      }

      try {
        await storage.createCronLog(
          "sftp_watcher",
          result.filesFailed > 0 ? "partial" : "success",
          `escaneados: ${result.filesScanned}, procesados: ${result.filesProcessed}, dup: ${result.filesSkippedDuplicate}, errores: ${result.filesFailed}, registros: ${result.recordsImported}`,
        );
      } catch {}

      return result;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.lastError = msg;
      this.pushError(`run: ${msg}`);
      result.globalError = msg;
      log(`SFTP watcher error: ${msg}`, "sftp");
      try { await storage.createCronLog("sftp_watcher", "error", msg); } catch {}
      return result;
    } finally {
      if (sftp) {
        try { await sftp.end(); } catch {}
      }
      this.isRunning = false;
    }
  }

  private async connectWithRetry(): Promise<SftpClient> {
    let attempt = 0;
    let lastErr: any;
    while (attempt < CONNECT_RETRIES) {
      attempt++;
      const sftp = new SftpClient();
      try {
        await sftp.connect({
          host: SFTP_HOST,
          port: SFTP_PORT,
          username: SFTP_USER,
          password: SFTP_PASSWORD,
          readyTimeout: READY_TIMEOUT_MS,
          retries: 0,
        });
        return sftp;
      } catch (e: any) {
        lastErr = e;
        try { await sftp.end(); } catch {}
        if (attempt < CONNECT_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, CONNECT_BACKOFF_MS * attempt),
          );
        }
      }
    }
    throw new Error(
      `SFTP connect failed tras ${CONNECT_RETRIES} intentos: ${lastErr?.message ?? lastErr}`,
    );
  }

  private pushError(message: string) {
    this.recentErrors.unshift({ at: Date.now(), message });
    if (this.recentErrors.length > MAX_RECENT_ERRORS) {
      this.recentErrors.length = MAX_RECENT_ERRORS;
    }
  }

  async getStatus(): Promise<SftpWatcherStatus> {
    const recent = await storage.listProcessedSftpFiles(20);
    const totalAllTime = await storage.countProcessedSftpFiles();
    return {
      enabled: !!SFTP_PASSWORD && process.env.ORNITELA_SFTP_DISABLED !== "1",
      running: this.isRunning,
      pollIntervalMs: POLL_INTERVAL_MS,
      host: SFTP_HOST,
      port: SFTP_PORT,
      user: SFTP_USER,
      remoteDir: SFTP_REMOTE_DIR,
      processedDir: SFTP_PROCESSED_DIR,
      lastRunAt: this.lastRunAt ? new Date(this.lastRunAt).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastError: this.lastError,
      totalRuns: this.totalRuns,
      totalFilesProcessed: this.totalFilesProcessed,
      totalFilesFailed: this.totalFilesFailed,
      totalRecordsImported: this.totalRecordsImported,
      recentErrors: this.recentErrors.map((e) => ({
        at: new Date(e.at).toISOString(),
        message: e.message,
      })),
      recentFiles: recent.map((r) => ({
        filename: r.filename,
        processedAt:
          r.processedAt instanceof Date
            ? r.processedAt.toISOString()
            : new Date(r.processedAt as any).toISOString(),
        recordsCount: r.recordsCount,
      })),
      totalProcessedAllTime: totalAllTime,
    };
  }
}

export const sftpWatcher = new SftpWatcher();

/**
 * Extrae el primer device_id no vacío de un CSV Ornitela (escanea hasta 10 filas).
 * Devuelve null si no hay columna device_id o valores.
 */
export function extractFirstDeviceId(csv: string): string | null {
  const cleaned = csv.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = parseCsvLine(lines[0], sep).map((h) =>
    h.trim().toLowerCase().replace(/^\uFEFF/, ""),
  );
  const idx = headers.findIndex((h) =>
    ["device_id", "deviceid", "dev_id", "tag_id", "tagid"].includes(h),
  );
  if (idx === -1) return null;
  const maxScan = Math.min(lines.length, 11);
  for (let i = 1; i < maxScan; i++) {
    const vals = parseCsvLine(lines[i], sep);
    const deviceId = (vals[idx] || "").trim();
    if (deviceId) return deviceId;
  }
  return null;
}

/**
 * Reprocesa retroactivamente los archivos SFTP que quedaron "sin asignar" para un
 * device_id concreto, importándolos al estudio indicado desde el contenido guardado
 * (no requiere que Ornitela reenvíe el dato ni una conexión SFTP). Las inserciones
 * son idempotentes, así que es seguro aunque el archivo se vuelva a procesar luego.
 */
export async function reprocessUnassignedForDevice(
  deviceId: string,
  studyId: string,
): Promise<{ files: number; gps: number; acc: number }> {
  const pending = await storage.getUnresolvedUnassignedFilesForDevice(deviceId);
  let files = 0;
  let gps = 0;
  let acc = 0;
  for (const f of pending) {
    try {
      const r = await parseOrnitelaCsv(f.csvContent, studyId, storage);
      gps += r.gpsImported;
      acc += r.accImported;
      files++;
      await storage.markUnassignedFileResolved(f.id, studyId);
      const already = await storage.getProcessedSftpFile(f.filename);
      if (!already) {
        await storage.recordProcessedSftpFile(f.filename, r.gpsImported + r.accImported);
      }
    } catch (e: any) {
      log(`SFTP reprocesado ${f.filename} (device ${deviceId}) falló: ${e?.message ?? e}`, "sftp");
    }
  }
  if (gps > 0 || acc > 0) {
    try {
      const { triggerImmobilityAnalysisInBackground } = await import("../immobilityDetector");
      triggerImmobilityAnalysisInBackground(studyId, "ornitela-allowlist-reprocess");
    } catch {}
  }
  return { files, gps, acc };
}
