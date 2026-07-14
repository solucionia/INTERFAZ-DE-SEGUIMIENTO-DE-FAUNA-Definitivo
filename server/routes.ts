import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import bcrypt from "bcryptjs";
import multer from "multer";
import { storage } from "./storage";
import { pool } from "./db";
import { setupAuth, requireAuth, requireSuperuser, checkRole } from "./auth";
import { fetchMovebankIndividuals, fetchMovebankDeployments, fetchMovebankEvents, fetchMovebankDeploymentIndividualMap, MovebankError } from "./movebank";
import { movebankRateLimiter, movebankDelay } from "./movebankRateLimit";
import { registerSchema, insertStudySchema, insertSpeciesProfileSchema, insertEmissionAlertSchema, insertSpeciesSchema, insertProjectSchema, DEFAULT_THRESHOLDS, normalizeThresholds, type EventThresholds, ANALYSIS_TYPES, type AnalysisType, EVENT_TYPES, type CachedGpsEvent, type CachedAccEvent, type Study, insertAccelerometerLabelSchema, deviceTransferSchema } from "@shared/schema";
import { detectEvents } from "./eventDetection";
import { sendEventAlert } from "./emailService";
import { runAnalysis, KERNEL_PERCENTAGES, MCP_PERCENTAGES, type AnalysisResult } from "./geoAnalysis";
import { decrypt, encrypt } from "./encryption";
import { log } from "./index";
import { authLimiter, apiLimiter, movebankLimiter } from "./rateLimiter";
import { parseOrnitelaCsv } from "./ornitelaCsvParser";
import { buildDeviceWindows, clipWindows, type DataWindow } from "./deploymentWindows";
import { ornitelaSync, OrnitelaSyncError, type OrnitelaDevice } from "./ornitelaSync";
import { runEventDetection, runEmissionCheck, runOrnitelaSync } from "./scheduler";
import { sftpWatcher, reprocessUnassignedForDevice } from "./services/sftpWatcher";

function fmtDate(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function buildValoresCsv(resultData: any): string {
  if (!resultData?.perIndividual) return "";

  const headers = [
    '""',
    "localizaciones",
    "dias_analisis",
    "total_recorrido_km",
    "distancia_minima_entre_localizaciones_km",
    "distancia_maxima_entre_localizaciones_km",
    "p_fecha",
    "u_fecha",
    "excentricidad",
    "linearidad",
    "minima_distancia_dia_km",
    "maxima_distancia_dia_km",
    "media_distancia_dia_km",
    "h_href",
    "h_lscv",
  ];

  const headerKernelPcts: number[] = Array.isArray(resultData.kernelPercentages) && resultData.kernelPercentages.length > 0
    ? [...resultData.kernelPercentages].sort((a: number, b: number) => a - b)
    : KERNEL_PERCENTAGES;
  for (const pct of headerKernelPcts) {
    headers.push(`hr_area${pct}`);
  }

  for (const pct of MCP_PERCENTAGES) {
    headers.push(`mcp_${pct}`);
  }

  let csv = headers.join(",") + "\n";

  const kernelPcts: number[] = Array.isArray(resultData.kernelPercentages) && resultData.kernelPercentages.length > 0
    ? [...resultData.kernelPercentages].sort((a: number, b: number) => a - b)
    : KERNEL_PERCENTAGES;

  for (const ind of resultData.perIndividual) {
    const row: (string | number)[] = [
      `"${ind.individual}"`,
      ind.locations,
      ind.analysisDays,
      ind.totalDistanceKm,
      ind.minConsecutiveDistKm,
      ind.maxConsecutiveDistKm,
      fmtDate(ind.firstDate),
      fmtDate(ind.lastDate),
      ind.eccentricity,
      ind.linearity,
      ind.minDailyDistKm,
      ind.maxDailyDistKm,
      ind.avgDailyDistKm,
      ind.hHref != null ? Math.round(ind.hHref * 1000 * 1000) / 1000 : "",
      ind.hLscv != null ? Math.round(ind.hLscv * 1000 * 1000) / 1000 : "",
    ];

    for (const pct of kernelPcts) {
      const km2 = ind.kernelHrefAreas?.[`${pct}`];
      row.push(km2 != null ? Math.round(km2 * 1e6 * 1000) / 1000 : "");
    }

    for (const pct of MCP_PERCENTAGES) {
      const km2 = ind.mcpAreas?.[`${pct}`];
      row.push(km2 != null ? Math.round(km2 * 1e6 * 1000) / 1000 : "");
    }

    csv += row.join(",") + "\n";
  }

  return csv;
}

function maskStudyCredentials(study: Study): Study {
  return {
    ...study,
    movebankUsername: study.movebankUsername ? "••••••••" : null,
    movebankPassword: study.movebankPassword ? "••••••••" : null,
    ornitelaUsername: study.ornitelaUsername ? "••••••••" : null,
    ornitelaPassword: study.ornitelaPassword ? "••••••••" : null,
  };
}

function hasMovebankCredentials(study: Study): boolean {
  return !!(study.movebankStudyId && study.movebankUsername && study.movebankPassword);
}

// Primera sincronización de un estudio Ornitela recién creado. Se ejecuta en
// background (fire-and-forget) tras crear el estudio: descubre los dispositivos
// del panel, importa sus CSV (lo que crea individuos/deployments) y deja el
// estudio listo para que el cron periódico lo siga sincronizando. Sin esto, el
// cron nunca arrancaría porque sólo procesa estudios que YA tienen deployments.
async function runOrnitelaFirstSync(studyId: string): Promise<void> {
  const FIRST_SYNC_HOURS_BACK = 168; // 7 días
  const DEVICE_DELAY_MS = 1500;
  try {
    const study = await storage.getStudyDecrypted(studyId);
    if (!study || !study.ornitelaEnabled || !study.ornitelaUsername || !study.ornitelaPassword) {
      return;
    }
    const panelUrl = study.ornitelaPanelUrl || "https://cpanel.glosendas.net";
    log(`Ornitela primera sincronización para estudio "${study.name}"...`, "ornitela");

    const session = await ornitelaSync.login(panelUrl, study.ornitelaUsername, study.ornitelaPassword);
    const devices = await ornitelaSync.getDeviceList(panelUrl, session);

    if (devices.length === 0) {
      await storage.updateStudy(studyId, { ornitelaLastSync: new Date() } as any);
      log(`Ornitela primera sincronización "${study.name}": no se encontraron dispositivos`, "ornitela");
      return;
    }

    const now = new Date();
    const fromDate = new Date(now.getTime() - FIRST_SYNC_HOURS_BACK * 60 * 60 * 1000);
    const fmtDt = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const h = String(d.getUTCHours()).padStart(2, "0");
      const min = String(d.getUTCMinutes()).padStart(2, "0");
      return `${y}-${m}-${day} ${h}:${min}`;
    };
    const fromStr = fmtDt(fromDate);
    const toStr = fmtDt(now);

    let totalGps = 0;
    let totalAcc = 0;
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, DEVICE_DELAY_MS));
      try {
        const csv = await ornitelaSync.downloadCSV(panelUrl, session, device.imei, fromStr, toStr);
        if (csv && csv.trim().length >= 10) {
          const result = await parseOrnitelaCsv(csv, studyId, storage, { ornitelaName: device.name });
          totalGps += result.gpsImported;
          totalAcc += result.accImported;
        }
      } catch (err: any) {
        log(`Ornitela primera sync error dispositivo ${device.name} (${device.imei}): ${err.message}`, "ornitela");
      }
    }

    await storage.updateStudy(studyId, { ornitelaLastSync: new Date() } as any);
    log(`Ornitela primera sincronización "${study.name}" completada — ${devices.length} dispositivos, ${totalGps} GPS, ${totalAcc} ACC`, "ornitela");

    if (totalGps > 0 || totalAcc > 0) {
      try {
        const { triggerImmobilityAnalysisInBackground } = await import("./immobilityDetector");
        triggerImmobilityAnalysisInBackground(studyId, "ornitela-first-sync");
      } catch {}
    }
  } catch (e: any) {
    log(`Ornitela primera sincronización falló para estudio ${studyId}: ${e.message}`, "ornitela");
  }
}

async function requireStudyAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "No autenticado" });
  }
  const user = req.user!;
  if (user.role === "superuser") return next();

  const studyId = (req.params.id || req.params.studyId) as string;
  const userStudyIds = (await storage.getStudiesForUser(user.id)).map((s) => s.id);
  if (!userStudyIds.includes(studyId as string)) {
    return res.status(403).json({ message: "Acceso denegado a este estudio" });
  }
  next();
}

// Resolve the device/time windows a given animal actually carried, so an emitter
// reassigned between animals never leaks GPS/ACC data across periods. `token` may
// be a current localIdentifier (current holder) or an individualId (an animal
// transferred away and no longer holding a device).
async function resolveDataWindows(studyId: string, token: string, tsStart: number, tsEnd: number): Promise<DataWindow[]> {
  let ind = await storage.getIndividualByLocalIdentifier(studyId, token);
  let historical = false;
  if (!ind) {
    const byId = await storage.getIndividualById(token);
    if (byId && byId.studyId === studyId) { ind = byId; historical = true; }
  }
  const deps = ind ? await storage.getDeviceDeploymentsForIndividual(ind.id) : [];
  return clipWindows(buildDeviceWindows(deps, historical ? null : token), tsStart, tsEnd);
}

async function clippedGpsFor(studyId: string, token: string, tsStart: number, tsEnd: number): Promise<CachedGpsEvent[]> {
  return storage.getCachedGpsEventsForWindows(studyId, await resolveDataWindows(studyId, token, tsStart, tsEnd));
}

async function clippedAccFor(studyId: string, token: string, tsStart: number, tsEnd: number): Promise<CachedAccEvent[]> {
  return storage.getCachedAccEventsForWindows(studyId, await resolveDataWindows(studyId, token, tsStart, tsEnd));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  const safeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };

  let syncAllRunning = false;
  let syncAllStartedAt: string | null = null;

  app.post("/api/sync-all", async (req: Request, res: Response) => {
    const expectedSecret = process.env.SYNC_SECRET;
    if (!expectedSecret) {
      return res.status(503).json({
        ok: false,
        error: "SYNC_SECRET no configurado en el servidor",
      });
    }

    const providedRaw = req.headers["x-sync-secret"];
    const provided = Array.isArray(providedRaw) ? providedRaw[0] : providedRaw;

    if (!provided || typeof provided !== "string" || !safeEqual(provided, expectedSecret)) {
      return res.status(401).json({ ok: false, error: "Token inválido" });
    }

    if (syncAllRunning) {
      return res.status(409).json({
        ok: false,
        error: "Ya hay una sincronización en curso",
        runningSince: syncAllStartedAt,
      });
    }
    syncAllRunning = true;

    const startedAt = new Date().toISOString();
    syncAllStartedAt = startedAt;
    const startedAtMs = Date.parse(startedAt);
    log("sync-all: ejecución manual iniciada via /api/sync-all", "sync-all");

    // Nota: immobility_check NO se incluye aquí. Tiene su propio cron dedicado
    // cada 2h (`IMMOBILITY_CRON_INTERVAL`) con mutex single-flight; incluirlo en
    // el bundle de 6h provocaría overlap en horas alineadas (0/6/12/18h) y
    // emails duplicados de "nuevas" alertas críticas.
    const tasks: { name: string; fn: () => Promise<void> }[] = [
      { name: "event_detection", fn: runEventDetection },
      { name: "emission_check", fn: runEmissionCheck },
      { name: "ornitela_sync", fn: runOrnitelaSync },
    ];

    const results: Record<string, {
      ok: boolean;
      durationSeconds: string;
      logStatus?: string;
      logDetails?: string | null;
      error?: string;
    }> = {};

    try {
      for (const t of tasks) {
        const t0 = Date.now();
        try {
          await t.fn();
        } catch (err: any) {
          results[t.name] = {
            ok: false,
            durationSeconds: ((Date.now() - t0) / 1000).toFixed(1),
            error: err?.message || String(err),
          };
          continue;
        }

        const durationSeconds = ((Date.now() - t0) / 1000).toFixed(1);
        try {
          const logRow = await pool.query<{ status: string; details: string | null }>(
            "SELECT status, details FROM cron_logs WHERE task_type = $1 AND run_at >= to_timestamp($2 / 1000.0) ORDER BY run_at DESC LIMIT 1",
            [t.name, startedAtMs]
          );
          const row = logRow.rows[0];
          if (row) {
            results[t.name] = {
              ok: row.status === "success" || row.status === "skipped",
              durationSeconds,
              logStatus: row.status,
              logDetails: row.details,
            };
          } else {
            results[t.name] = { ok: true, durationSeconds, logStatus: "no_log" };
          }
        } catch {
          results[t.name] = { ok: true, durationSeconds, logStatus: "log_query_failed" };
        }
      }
    } finally {
      syncAllRunning = false;
      syncAllStartedAt = null;
    }

    const finishedAt = new Date().toISOString();
    const totalSeconds = Math.round((Date.parse(finishedAt) - startedAtMs) / 1000);
    log(`sync-all: ejecución manual completada en ${totalSeconds}s`, "sync-all");

    return res.json({
      ok: true,
      startedAt,
      finishedAt,
      totalSeconds,
      tasks: results,
    });
  });

  app.use("/api", apiLimiter);

  app.post("/api/auth/register", authLimiter, async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }
      const { name, email, password } = parsed.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Este email ya está registrado" });
      }

      const count = await storage.getUserCount();
      const role = count === 0 ? "superuser" : "user";
      const hashed = await bcrypt.hash(password, 10);

      const user = await storage.createUser({ name, email, password: hashed, role });

      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _, ...safe } = user;
        return res.json(safe);
      });
    } catch (e: any) {
      log(`Register error: ${e.message}`, "auth");
      return res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  app.post("/api/auth/login", authLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Credenciales inválidas" });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _, ...safe } = user;
        return res.json(safe);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Error al cerrar sesión" });
      return res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "No autenticado" });
    }
    const { password: _, ...safe } = req.user!;
    return res.json(safe);
  });

  app.get("/api/users", requireSuperuser, async (_req, res) => {
    const users = await storage.getAllUsers();
    const safe = users.map(({ password: _, ...u }) => u);
    return res.json(safe);
  });

  app.post("/api/users", requireSuperuser, async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos invalidos" });
      }
      const { name, email, password } = parsed.data;
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Este email ya esta registrado" });
      }
      const hashed = await bcrypt.hash(password, 10);
      const validRoles = ["superuser", "user", "observer"];
      const assignRole = validRoles.includes(req.body.role) ? req.body.role : "user";
      const user = await storage.createUser({ name, email, password: hashed, alertEmail: req.body.alertEmail || null, role: assignRole });
      await storage.createActivityLog({ userId: req.user!.id, action: "create_user", resource: "user", resourceId: user.id, details: `Creo usuario ${name}` });
      const { password: _, ...safe } = user;
      return res.json(safe);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    const user = req.user!;
    if (user.role !== "superuser" && user.id !== req.params.id) {
      return res.status(403).json({ message: "Acceso denegado" });
    }
    const updateData: Partial<{ alertEmail: string | null; role: string; password: string; name: string }> = {};

    if (req.body.alertEmail !== undefined) {
      updateData.alertEmail = req.body.alertEmail;
    }
    if (req.body.name !== undefined) {
      updateData.name = req.body.name;
    }

    if (req.body.role !== undefined) {
      if (user.role !== "superuser") {
        return res.status(403).json({ message: "Solo superusuarios pueden cambiar roles" });
      }
      if (user.id === req.params.id) {
        return res.status(400).json({ message: "No puedes cambiar tu propio rol" });
      }
      if (!["superuser", "user", "observer"].includes(req.body.role)) {
        return res.status(400).json({ message: "Rol inválido" });
      }
      updateData.role = req.body.role;
    }

    if (req.body.newPassword !== undefined) {
      if (user.role !== "superuser" && user.id !== req.params.id) {
        return res.status(403).json({ message: "Acceso denegado" });
      }
      if (req.body.newPassword.length < 6) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
      }
      updateData.password = await bcrypt.hash(req.body.newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No hay datos para actualizar" });
    }

    const updated = await storage.updateUser(req.params.id, updateData);
    if (!updated) return res.status(404).json({ message: "Usuario no encontrado" });
    const { password: _, ...safe } = updated;
    return res.json(safe);
  });

  app.get("/api/movebank/status", requireAuth, async (req, res) => {
    return res.json(movebankRateLimiter.getStatus());
  });

  app.get("/api/sftp/status", requireAuth, async (_req, res) => {
    try {
      const status = await sftpWatcher.getStatus();
      return res.json(status);
    } catch (e: any) {
      return res.status(500).json({ message: `Error obteniendo estado SFTP: ${e.message}` });
    }
  });

  app.post("/api/sftp/run-now", checkRole("superuser"), async (_req, res) => {
    try {
      const result = await sftpWatcher.tick();
      if (result === null) {
        return res.status(409).json({ message: "Ya hay una ejecución SFTP en curso" });
      }
      if (result.globalError) {
        return res.status(502).json({
          message: `Fallo SFTP: ${result.globalError}`,
          result,
        });
      }
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ message: `Error ejecutando SFTP: ${e.message}` });
    }
  });

  // Archivos SFTP que no se pudieron asignar a ningún estudio (visibilidad del fallo).
  app.get("/api/sftp/unassigned", requireSuperuser, async (_req, res) => {
    try {
      const files = await storage.listUnassignedSftpFiles({ limit: 200 });
      return res.json(files);
    } catch (e: any) {
      return res.status(500).json({ message: `Error listando archivos sin asignar: ${e.message}` });
    }
  });

  // Allowlist de dispositivos Ornitela por estudio (asociación explícita device→estudio).
  app.get("/api/studies/:id/ornitela-devices", requireSuperuser, async (req, res) => {
    try {
      const devices = await storage.getOrnitelaDeviceStudies(req.params.id);
      return res.json(devices);
    } catch (e: any) {
      return res.status(500).json({ message: `Error listando dispositivos: ${e.message}` });
    }
  });

  app.post("/api/studies/:id/ornitela-devices", requireSuperuser, async (req, res) => {
    try {
      const study = await storage.getStudy(req.params.id);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
      const deviceId = String(req.body?.deviceId ?? "").trim();
      if (!deviceId) return res.status(400).json({ message: "device_id requerido" });
      const userId = (req.user as any)?.id ?? null;
      const added = await storage.addOrnitelaDeviceStudy(study.id, deviceId, userId);
      const reprocessed = await reprocessUnassignedForDevice(deviceId, study.id);
      return res.json({ added, reprocessed });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/studies/:id/ornitela-devices/:deviceId", requireSuperuser, async (req, res) => {
    try {
      await storage.removeOrnitelaDeviceStudy(req.params.id, req.params.deviceId);
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/dashboard/summary", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      let studyList;
      if (user.role === "superuser") {
        studyList = await storage.getAllStudies();
      } else {
        studyList = await storage.getStudiesForUser(user.id);
      }
      const studyIds = studyList.map((s) => s.id);
      const summary = await storage.getDashboardSummary(studyIds);
      return res.json(summary);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/alerts/history", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const { studyId, eventType, individualLocalId, readStatus, resolvedStatus, timestampStart, timestampEnd, limit, offset } = req.query;

      let accessibleStudyIds: string[];
      if (user.role === "superuser") {
        const allStudies = await storage.getAllStudies();
        accessibleStudyIds = allStudies.map((s) => s.id);
      } else {
        accessibleStudyIds = (await storage.getStudiesForUser(user.id)).map((s) => s.id);
      }

      const filterStudyId = studyId as string | undefined;
      if (filterStudyId && !accessibleStudyIds.includes(filterStudyId)) {
        return res.status(403).json({ message: "Acceso denegado" });
      }

      const filters: any = {
        studyId: filterStudyId,
        eventType: eventType as string | undefined,
        individualLocalId: individualLocalId as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      };
      if (readStatus !== undefined) filters.readStatus = readStatus === "true";
      if (resolvedStatus !== undefined) filters.resolvedStatus = resolvedStatus === "true";
      if (timestampStart) filters.timestampStart = parseInt(timestampStart as string, 10);
      if (timestampEnd) filters.timestampEnd = parseInt(timestampEnd as string, 10);

      if (!filterStudyId && accessibleStudyIds.length > 0) {
        filters.studyId = undefined;
      }

      const result = await storage.getAllDetectedEvents(filters);
      if (!filterStudyId) {
        result.events = result.events.filter((e) => accessibleStudyIds.includes(e.studyId));
      }

      const stats = await storage.getDetectedEventStats(accessibleStudyIds);
      return res.json({ ...result, stats });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/alerts/:id", requireAuth, async (req, res) => {
    const { readStatus, resolvedStatus } = req.body;
    const updated = await storage.updateDetectedEvent(req.params.id, { readStatus, resolvedStatus });
    if (!updated) return res.status(404).json({ message: "Alerta no encontrada" });
    return res.json(updated);
  });

  app.patch("/api/alerts/bulk/read", requireAuth, async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ message: "ids requeridos" });
    for (const id of ids) {
      await storage.updateDetectedEvent(id, { readStatus: true });
    }
    return res.json({ ok: true, count: ids.length });
  });

  app.get("/api/activity-logs", requireSuperuser, async (req, res) => {
    const { limit, offset } = req.query;
    const result = await storage.getActivityLogs({
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    return res.json(result);
  });

  app.get("/api/studies/:id/data-range", requireStudyAccess, async (req, res) => {
    try {
      const studyId = req.params.id as string;
      const raw = (req.query.individuals as string) || "";
      const individualsList = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (individualsList.length === 0) {
        return res.json({ min: null, max: null });
      }
      let min: number | null = null;
      let max: number | null = null;
      for (const ind of individualsList) {
        for (const sensor of ["gps", "acc"] as const) {
          const r = await storage.getCachedTimestampRange(studyId, ind, sensor);
          if (r) {
            if (min === null || r.min < min) min = r.min;
            if (max === null || r.max > max) max = r.max;
          }
        }
      }
      res.json({ min, max });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/studies/:id/export-kml", checkRole("superuser", "user"), requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudy(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const { individuals: individualIds, timestamp_start, timestamp_end } = req.query;
      if (!individualIds || !timestamp_start || !timestamp_end) {
        return res.status(400).json({ message: "Parametros requeridos: individuals, timestamp_start, timestamp_end" });
      }

      const ids = (individualIds as string).split(",");
      const tsStart = parseInt(timestamp_start as string, 10);
      const tsEnd = parseInt(timestamp_end as string, 10);

      let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${study.name}</name>\n`;

      for (const animalId of ids) {
        const cached = await clippedGpsFor(study.id, animalId.trim(), tsStart, tsEnd);
        const coords = cached
          .map((c) => `${c.longitude},${c.latitude},0`)
          .join("\n");

        if (coords) {
          kml += `<Placemark>\n<name>${animalId.trim()}</name>\n<LineString>\n<coordinates>\n${coords}\n</coordinates>\n</LineString>\n</Placemark>\n`;
        }
      }

      kml += `</Document>\n</kml>`;
      res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
      res.setHeader("Content-Disposition", `attachment; filename="${study.name}_tracks.kml"`);
      return res.send(kml);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/studies/:id/export-visualization", checkRole("superuser", "user"), requireStudyAccess, async (req, res) => {
    try {
      const { z } = await import("zod");
      const bodySchema = z.object({
        individualIds: z.array(z.string()).min(1),
        startDate: z.coerce.number(),
        endDate: z.coerce.number(),
        format: z.enum(["csv", "kmz", "shp", "geojson"]),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.flatten() });
      }
      const { individualIds, startDate, endDate, format: fmt } = parsed.data;
      const study = await storage.getStudy(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const allPoints: { individual: string; timestamp: number; lat: number; lng: number; speed: number | null; heading: number | null; altitude: number | null }[] = [];
      for (const animalId of individualIds) {
        const events = await clippedGpsFor(req.params.id as string, animalId, startDate, endDate);
        for (const e of events) {
          allPoints.push({
            individual: e.individualLocalIdentifier,
            timestamp: e.timestamp,
            lat: e.latitude,
            lng: e.longitude,
            speed: e.groundSpeed,
            heading: e.heading,
            altitude: e.heightAboveEllipsoid,
          });
        }
      }

      if (allPoints.length === 0) {
        return res.status(404).json({ message: "No hay datos GPS en caché para los individuos y rango seleccionados" });
      }

      allPoints.sort((a, b) => a.individual.localeCompare(b.individual) || a.timestamp - b.timestamp);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const animalLabel = individualIds.length === 1 ? individualIds[0].replace(/[^a-zA-Z0-9_-]/g, "_") : `${individualIds.length}_animales`;

      if (fmt === "csv") {
        let csv = "individual,timestamp,datetime,latitude,longitude,ground_speed,heading,altitude\n";
        for (const p of allPoints) {
          csv += `"${p.individual}",${p.timestamp},"${new Date(p.timestamp).toISOString()}",${p.lat},${p.lng},${p.speed ?? ""},${p.heading ?? ""},${p.altitude ?? ""}\n`;
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${animalLabel}_${dateStr}.csv"`);
        return res.send(csv);
      }

      if (fmt === "geojson") {
        const features: any[] = [];
        const byAnimal: Record<string, typeof allPoints> = {};
        for (const p of allPoints) {
          if (!byAnimal[p.individual]) byAnimal[p.individual] = [];
          byAnimal[p.individual].push(p);
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lng, p.lat, p.altitude ?? 0] },
            properties: {
              individual: p.individual,
              timestamp: p.timestamp,
              datetime: new Date(p.timestamp).toISOString(),
              speed: p.speed,
              heading: p.heading,
              altitude: p.altitude,
            },
          });
        }
        for (const [animal, pts] of Object.entries(byAnimal)) {
          if (pts.length >= 2) {
            features.push({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: pts.map((p) => [p.lng, p.lat, p.altitude ?? 0]),
              },
              properties: { individual: animal, type: "trajectory", points: pts.length },
            });
          }
        }
        const geojson = { type: "FeatureCollection", features };
        res.setHeader("Content-Type", "application/geo+json");
        res.setHeader("Content-Disposition", `attachment; filename="${animalLabel}_${dateStr}.geojson"`);
        return res.send(JSON.stringify(geojson, null, 2));
      }

      if (fmt === "kmz") {
        const JSZip = (await import("jszip")).default;
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${esc(study.name || "")}</name>\n`;
        kml += `<Style id="point-style"><IconStyle><scale>0.5</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon></IconStyle></Style>\n`;
        kml += `<Style id="line-style"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle></Style>\n`;

        const individuals = await storage.getIndividuals(req.params.id as string);
        const indByLocalId = new Map<string, typeof individuals[number]>();
        for (const ind of individuals) {
          if (ind.localIdentifier) indByLocalId.set(ind.localIdentifier, ind);
        }
        const animalLabelFor = (localId: string): string => {
          const ind = indByLocalId.get(localId);
          const name = ((ind?.ornitelaName ?? ind?.nickName) ?? "").trim();
          const id = (ind?.localIdentifier ?? localId ?? "").trim() || localId;
          if (name && id) return `${name} (${id})`;
          return id || name || localId;
        };

        const byAnimal: Record<string, typeof allPoints> = {};
        for (const p of allPoints) {
          if (!byAnimal[p.individual]) byAnimal[p.individual] = [];
          byAnimal[p.individual].push(p);
        }

        for (const [animal, pts] of Object.entries(byAnimal)) {
          const animalLbl = esc(animalLabelFor(animal));
          kml += `<Folder>\n<name>${animalLbl}</name>\n`;
          for (const p of pts) {
            const validTs = Number.isFinite(p.timestamp) && !Number.isNaN(new Date(p.timestamp).getTime());
            const dt = validTs ? new Date(p.timestamp).toISOString() : "";
            const pointName = validTs ? esc(dt.slice(0, 19).replace("T", " ")) : "";
            kml += `<Placemark>\n<name>${pointName}</name>\n<styleUrl>#point-style</styleUrl>\n`;
            kml += `<description>${esc(`Fecha: ${dt || "N/A"}\nVelocidad: ${p.speed ?? "N/A"} m/s\nAltitud: ${p.altitude ?? "N/A"} m`)}</description>\n`;
            if (validTs) kml += `<TimeStamp><when>${dt}</when></TimeStamp>\n`;
            kml += `<Point><coordinates>${p.lng},${p.lat},${p.altitude ?? 0}</coordinates></Point>\n`;
            kml += `</Placemark>\n`;
          }
          if (pts.length >= 2) {
            const coords = pts.map((p) => `${p.lng},${p.lat},${p.altitude ?? 0}`).join("\n");
            kml += `<Placemark>\n<name>Trayectoria ${animalLbl}</name>\n<styleUrl>#line-style</styleUrl>\n`;
            kml += `<LineString>\n<tessellate>1</tessellate>\n<coordinates>\n${coords}\n</coordinates>\n</LineString>\n`;
            kml += `</Placemark>\n`;
          }
          kml += `</Folder>\n`;
        }
        kml += `</Document>\n</kml>`;

        const zip = new JSZip();
        zip.file("doc.kml", kml);
        const kmzBuffer = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
        res.setHeader("Content-Disposition", `attachment; filename="${animalLabel}_${dateStr}.kmz"`);
        return res.send(kmzBuffer);
      }

      if (fmt === "shp") {
        const JSZip = (await import("jszip")).default;
        // Escritor de bajo nivel de shp-write (mismo enfoque que export-geospatial):
        // genera shapefiles binarios reales (.shp/.shx/.dbf), no un GeoJSON envuelto.
        // @ts-ignore - shp-write no incluye tipos
        const shpModule: any = await import("shp-write");
        const shpwriteWrite: (rows: any[], type: string, geometries: any[], cb: (err: any, files: any) => void) => void =
          shpModule.default?.write ?? shpModule.write;
        if (typeof shpwriteWrite !== "function") {
          return res.status(500).json({ message: "No se pudo cargar el generador de shapefiles (shp-write)." });
        }

        if (allPoints.length === 0) {
          return res.status(400).json({ message: "No hay puntos GPS para exportar en el rango seleccionado." });
        }

        // EPSG:4326 / WGS84. El .cpg declara ISO-8859-1 porque la librería dbf
        // escribe los caracteres como bytes Latin-1.
        const prjContent = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]`;
        const cpgContent = "ISO-8859-1";

        const buildShp = (rows: any[], type: string, geometries: any[]) =>
          new Promise<{ shp: ArrayBuffer; shx: ArrayBuffer; dbf: ArrayBuffer }>((resolve, reject) => {
            shpwriteWrite(rows, type, geometries, (err, files) => {
              if (err) return reject(err);
              resolve({ shp: files.shp.buffer, shx: files.shx.buffer, dbf: files.dbf.buffer });
            });
          });

        const zip = new JSZip();

        // 1) Puntos GPS (geometría POINT: cada elemento es [lng, lat]).
        const pointGeometries = allPoints.map((p) => [p.lng, p.lat]);
        const pointRows = allPoints.map((p) => ({
          animal: String(p.individual ?? ""),
          ts: p.timestamp,
          datetime: new Date(p.timestamp).toISOString(),
          lat: p.lat,
          lon: p.lng,
          speed: p.speed ?? 0,
          alt: p.altitude ?? 0,
        }));
        const pointFiles = await buildShp(pointRows, "POINT", pointGeometries);
        zip.file("gps_points.shp", pointFiles.shp, { binary: true });
        zip.file("gps_points.shx", pointFiles.shx, { binary: true });
        zip.file("gps_points.dbf", pointFiles.dbf, { binary: true });
        zip.file("gps_points.prj", prjContent);
        zip.file("gps_points.cpg", cpgContent);

        // 2) Trayectorias por individuo (geometría POLYLINE: cada elemento es
        //    [ linea ] y la linea es un array de [lng, lat]).
        const byIndividual = new Map<string, typeof allPoints>();
        for (const p of allPoints) {
          const key = String(p.individual ?? "");
          if (!byIndividual.has(key)) byIndividual.set(key, []);
          byIndividual.get(key)!.push(p);
        }
        const lineGeometries: number[][][][] = [];
        const lineRows: any[] = [];
        for (const [animal, pts] of Array.from(byIndividual.entries())) {
          const ordered = [...pts].sort((a, b) => a.timestamp - b.timestamp);
          if (ordered.length < 2) continue;
          lineGeometries.push([ordered.map((p) => [p.lng, p.lat])]);
          lineRows.push({
            animal,
            points: ordered.length,
            start: new Date(ordered[0].timestamp).toISOString(),
            end: new Date(ordered[ordered.length - 1].timestamp).toISOString(),
          });
        }
        if (lineGeometries.length > 0) {
          const lineFiles = await buildShp(lineRows, "POLYLINE", lineGeometries);
          zip.file("track_lines.shp", lineFiles.shp, { binary: true });
          zip.file("track_lines.shx", lineFiles.shx, { binary: true });
          zip.file("track_lines.dbf", lineFiles.dbf, { binary: true });
          zip.file("track_lines.prj", prjContent);
          zip.file("track_lines.cpg", cpgContent);
        }

        const shpBuf = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${animalLabel}_${dateStr}_shp.zip"`);
        return res.send(shpBuf);
      }

      return res.status(400).json({ message: "Formato no soportado" });
    } catch (e: any) {
      log(`Export visualization error: ${e.message}`, "routes");
      return res.status(500).json({ message: `Error al exportar: ${e.message}` });
    }
  });

  app.post("/api/studies/:id/export-geospatial", checkRole("superuser", "user"), requireStudyAccess, async (req, res) => {
    try {
      const { z } = await import("zod");
      const bodySchema = z.object({
        individualIds: z.array(z.string()).min(1),
        startDate: z.coerce.number(),
        endDate: z.coerce.number(),
        analysisType: z.enum(["mcp", "kernel", "distance", "speed", "comprehensive"]),
        format: z.enum(["csv", "kmz", "shp", "geojson"]),
        mcpPercent: z.number().optional(),
        bandwidthMethod: z.string().optional(),
        kernelPercentages: z.array(z.number()).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.flatten() });
      }
      const { individualIds, startDate, endDate, analysisType, format: fmt, mcpPercent, bandwidthMethod, kernelPercentages } = parsed.data;
      const study = await storage.getStudy(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const { runAnalysis } = await import("./geoAnalysis");
      const allPoints: { lat: number; lng: number; timestamp: number; individual: string; speed: number | null; altitude: number | null }[] = [];
      for (const animalId of individualIds) {
        const events = await clippedGpsFor(req.params.id as string, animalId, startDate, endDate);
        for (const e of events) {
          allPoints.push({
            individual: e.individualLocalIdentifier,
            timestamp: e.timestamp,
            lat: e.latitude,
            lng: e.longitude,
            speed: e.groundSpeed,
            altitude: e.heightAboveEllipsoid,
          });
        }
      }

      if (allPoints.length === 0) {
        return res.status(404).json({ message: "No hay datos GPS en caché para los individuos y rango seleccionados" });
      }

      const gpsForAnalysis = allPoints.map(p => ({ individual_id: p.individual, timestamp: p.timestamp, latitude: p.lat, longitude: p.lng }));
      const analysisResult = runAnalysis(analysisType as any, gpsForAnalysis, {
        mcpPercent: mcpPercent || 95,
        bandwidthMethod: (bandwidthMethod as any) || "href",
        kernelPercentages,
      });

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const animalLabel = individualIds.length === 1 ? individualIds[0].replace(/[^a-zA-Z0-9_-]/g, "_") : `${individualIds.length}_animales`;
      const dateStartStr = new Date(startDate).toISOString().slice(0, 10);
      const dateEndStr = new Date(endDate).toISOString().slice(0, 10);

      if (fmt === "csv") {
        let csv = "";
        if (analysisType === "comprehensive" && (analysisResult as any).perIndividual) {
          csv = "Animal,Eccentricidad,Linealidad,h_HREF,h_LSCV";
          const kernelPcts: number[] = Array.isArray((analysisResult as any).kernelPercentages) && (analysisResult as any).kernelPercentages.length > 0
            ? [...(analysisResult as any).kernelPercentages].sort((a: number, b: number) => a - b)
            : [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
          const mcpPcts = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
          for (const p of kernelPcts) csv += `,Kernel_HREF_${p}%_km2`;
          for (const p of kernelPcts) csv += `,Kernel_LSCV_${p}%_km2`;
          for (const p of mcpPcts) csv += `,MPC_${p}%_km2`;
          csv += ",Distancia_total_km,Velocidad_media_ms,Puntos\n";
          for (const ind of (analysisResult as any).perIndividual) {
            csv += `"${ind.individual}",${ind.eccentricity?.toFixed(4) ?? ""},${ind.linearity?.toFixed(4) ?? ""},${ind.hHref?.toFixed(2) ?? ""},${ind.hLscv?.toFixed(2) ?? ""}`;
            for (const p of kernelPcts) csv += `,${ind.kernelHrefAreas?.[String(p)]?.toFixed(6) ?? ""}`;
            for (const p of kernelPcts) csv += `,${ind.kernelLscvAreas?.[String(p)]?.toFixed(6) ?? ""}`;
            for (const p of mcpPcts) csv += `,${ind.mcpAreas?.[String(p)]?.toFixed(6) ?? ""}`;
            csv += `,${ind.totalDistance?.toFixed(3) ?? ""},${ind.meanSpeed?.toFixed(4) ?? ""},${ind.numPoints ?? ""}\n`;
          }
        } else if ((analysisResult as any).areas) {
          const arr: any[] = (analysisResult as any).areas as any[];
          if (analysisType === "kernel") {
            const pcts: number[] = Array.isArray((analysisResult as any).kernelPercentages) && (analysisResult as any).kernelPercentages.length > 0
              ? [...(analysisResult as any).kernelPercentages].sort((a: number, b: number) => a - b)
              : [50, 95];
            csv = `Animal,${pcts.map((p) => `Area_${p}_km2`).join(",")}\n`;
            for (const row of arr) {
              const r: (string | number)[] = [`"${row.individual ?? ""}"`];
              for (const p of pcts) {
                const v = row.areas?.[String(p)] ?? row[`area_${p}_km2`];
                r.push(typeof v === "number" ? v : "");
              }
              csv += r.join(",") + "\n";
            }
          } else {
            const keys = Object.keys(arr[0] || {}).filter((k) => typeof (arr[0] as any)[k] !== "object" || (arr[0] as any)[k] === null);
            csv = keys.join(",") + "\n";
            for (const row of arr) {
              csv += keys.map(k => {
                const v = (row as any)[k];
                return typeof v === "string" ? `"${v}"` : (v ?? "");
              }).join(",") + "\n";
            }
          }
        } else {
          csv = "analysis_type,result\n";
          csv += `"${analysisType}","No tabular data available"\n`;
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="geo_${analysisType}_${animalLabel}_${dateStr}.csv"`);
        return res.send(csv);
      }

      const polygonFeatures: any[] = [];
      const pointFeatures: any[] = [];

      // Para análisis "kernel" y "comprehensive" exportamos SOLO los contornos KDE
      // (home range con los percentiles configurados por el usuario). El análisis
      // comprehensive también genera polígonos MCP (intervalos fijos 20–100%) como
      // subproducto tabular; esos NO deben acabar en el GeoJSON/KMZ/SHP, que deben
      // contener el equivalente a las capas home_range_<pct> de QGIS. Solo cuando el
      // usuario pide explícitamente "mcp" exportamos los polígonos MCP.
      const keepPolygon = (f: any): boolean => {
        const geomType = f.geometry?.type;
        if (geomType !== "Polygon" && geomType !== "MultiPolygon") return false;
        if (analysisType !== "mcp" && f.properties?.type === "mcp") return false;
        return true;
      };

      if ((analysisResult as any).geojson?.features) {
        for (const f of (analysisResult as any).geojson.features) {
          if (!keepPolygon(f)) continue;
          polygonFeatures.push({
            ...f,
            properties: {
              ...f.properties,
              analysis_type: analysisType,
              study_name: study.name,
              date_start: dateStartStr,
              date_end: dateEndStr,
            },
          });
        }
      }

      if ((analysisResult as any).perIndividual) {
        for (const ind of (analysisResult as any).perIndividual) {
          if (ind.geojson?.features) {
            for (const f of ind.geojson.features) {
              if (!keepPolygon(f)) continue;
              polygonFeatures.push({
                ...f,
                properties: {
                  ...f.properties,
                  analysis_type: analysisType,
                  study_name: study.name,
                  date_start: dateStartStr,
                  date_end: dateEndStr,
                },
              });
            }
          }
        }
      }

      for (const p of allPoints) {
        pointFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat, p.altitude ?? 0] },
          properties: {
            individual: p.individual,
            timestamp: p.timestamp,
            datetime: new Date(p.timestamp).toISOString(),
            speed: p.speed,
            altitude: p.altitude,
          },
        });
      }

      if (fmt === "geojson") {
        const geojson = { type: "FeatureCollection", features: [...polygonFeatures, ...pointFeatures] };
        res.setHeader("Content-Type", "application/geo+json");
        res.setHeader("Content-Disposition", `attachment; filename="geo_${analysisType}_${animalLabel}_${dateStr}.geojson"`);
        return res.send(JSON.stringify(geojson, null, 2));
      }

      if (fmt === "kmz") {
        const JSZip = (await import("jszip")).default;
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${esc(study.name || "")} - ${analysisType.toUpperCase()}</name>\n`;
        kml += `<Style id="point-style"><IconStyle><scale>0.5</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon></IconStyle></Style>\n`;
        kml += `<Style id="polygon-style"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle><PolyStyle><color>400000ff</color></PolyStyle></Style>\n`;
        kml += `<Style id="line-style"><LineStyle><color>ff00ff00</color><width>2</width></LineStyle></Style>\n`;

        if (polygonFeatures.length > 0) {
          kml += `<Folder>\n<name>Polígonos ${analysisType.toUpperCase()}</name>\n`;
          for (const f of polygonFeatures) {
            const props = f.properties || {};
            const name = props.id || props.individual || "Polygon";
            const pType = props.type || analysisType;
            const pct = props.percent || props.level || "";
            const area = props.area_km2 !== undefined ? `${props.area_km2.toFixed(3)} km²` : "";
            kml += `<Placemark>\n<name>${esc(`${name} - ${pType} ${pct}`)}</name>\n<styleUrl>#polygon-style</styleUrl>\n`;
            kml += `<description>${esc(`Tipo: ${pType}\nPorcentaje: ${pct}\nÁrea: ${area}\nPeriodo: ${dateStartStr} a ${dateEndStr}`)}</description>\n`;
            const geom = f.geometry;
            if (geom.type === "Polygon") {
              const coords = geom.coordinates[0].map((c: number[]) => `${c[0]},${c[1]},0`).join("\n");
              kml += `<Polygon>\n<outerBoundaryIs>\n<LinearRing>\n<coordinates>\n${coords}\n</coordinates>\n</LinearRing>\n</outerBoundaryIs>\n</Polygon>\n`;
            } else if (geom.type === "MultiPolygon") {
              kml += `<MultiGeometry>\n`;
              for (const poly of geom.coordinates) {
                const coords = poly[0].map((c: number[]) => `${c[0]},${c[1]},0`).join("\n");
                kml += `<Polygon>\n<outerBoundaryIs>\n<LinearRing>\n<coordinates>\n${coords}\n</coordinates>\n</LinearRing>\n</outerBoundaryIs>\n</Polygon>\n`;
              }
              kml += `</MultiGeometry>\n`;
            }
            kml += `</Placemark>\n`;
          }
          kml += `</Folder>\n`;
        }

        const byAnimal: Record<string, typeof allPoints> = {};
        for (const p of allPoints) {
          if (!byAnimal[p.individual]) byAnimal[p.individual] = [];
          byAnimal[p.individual].push(p);
        }
        kml += `<Folder>\n<name>Puntos GPS</name>\n`;
        for (const [animal, pts] of Object.entries(byAnimal)) {
          const safeAnimal = esc(animal);
          kml += `<Folder>\n<name>${safeAnimal}</name>\n`;
          for (const p of pts) {
            const dt = new Date(p.timestamp).toISOString();
            kml += `<Placemark>\n<name>${safeAnimal}</name>\n<styleUrl>#point-style</styleUrl>\n`;
            kml += `<TimeStamp><when>${dt}</when></TimeStamp>\n`;
            kml += `<Point><coordinates>${p.lng},${p.lat},${p.altitude ?? 0}</coordinates></Point>\n`;
            kml += `</Placemark>\n`;
          }
          if (pts.length >= 2) {
            const coords = pts.map(p => `${p.lng},${p.lat},${p.altitude ?? 0}`).join("\n");
            kml += `<Placemark>\n<name>Trayectoria ${safeAnimal}</name>\n<styleUrl>#line-style</styleUrl>\n`;
            kml += `<LineString>\n<tessellate>1</tessellate>\n<coordinates>\n${coords}\n</coordinates>\n</LineString>\n`;
            kml += `</Placemark>\n`;
          }
          kml += `</Folder>\n`;
        }
        kml += `</Folder>\n`;
        kml += `</Document>\n</kml>`;

        const zip = new JSZip();
        zip.file("doc.kml", kml);
        const kmzBuffer = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
        res.setHeader("Content-Disposition", `attachment; filename="geo_${analysisType}_${animalLabel}_${dateStr}.kmz"`);
        return res.send(kmzBuffer);
      }

      if (fmt === "shp") {
        const JSZip = (await import("jszip")).default;
        // Usamos el escritor de bajo nivel de shp-write directamente; el wrapper
        // geojson.polygon() de la librería descarta agujeros/MultiPolygon y mezcla
        // todos los rasgos en un único registro, por lo que no sirve aquí.
        // @ts-ignore - shp-write no incluye tipos
        const shpModule: any = await import("shp-write");
        const shpwriteWrite: (rows: any[], type: string, geometries: any[], cb: (err: any, files: any) => void) => void =
          shpModule.default?.write ?? shpModule.write;
        if (typeof shpwriteWrite !== "function") {
          return res.status(500).json({ message: "No se pudo cargar el generador de shapefiles (shp-write)." });
        }

        // EPSG:4326 / WGS84 (WKT ESRI). El .cpg declara ISO-8859-1 porque la
        // librería dbf escribe los caracteres como bytes Latin-1 (charCodeAt).
        const prjContent = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]`;
        const cpgContent = "ISO-8859-1";

        // Orientación de anillos según el estándar shapefile: exterior en sentido
        // horario (área < 0), agujeros en sentido antihorario (área > 0).
        const ringSignedArea = (ring: number[][]): number => {
          let a = 0;
          for (let i = 0; i < ring.length - 1; i++) {
            a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
          }
          return a / 2;
        };
        const orientPolygon = (rings: number[][][]): number[][][] =>
          rings.map((ring, idx) => {
            const a = ringSignedArea(ring);
            if (idx === 0) return a > 0 ? [...ring].reverse() : ring; // exterior -> CW
            return a < 0 ? [...ring].reverse() : ring;                // agujero -> CCW
          });
        const orientedCoords = (f: any): any =>
          f.geometry?.type === "MultiPolygon"
            ? f.geometry.coordinates.map(orientPolygon)
            : orientPolygon(f.geometry.coordinates);

        const featPct = (f: any): number => {
          const raw = f.properties?.percent ?? f.properties?.level;
          return typeof raw === "number" ? raw : parseFloat(String(raw));
        };

        // Agrupar los polígonos por percentil -> un shapefile independiente por grupo.
        const groups = new Map<number, any[]>();
        for (const f of polygonFeatures) {
          const pct = featPct(f);
          if (!Number.isFinite(pct)) continue;
          if (!groups.has(pct)) groups.set(pct, []);
          groups.get(pct)!.push(f);
        }

        if (groups.size === 0) {
          return res.status(400).json({
            message: "No hay polígonos de home range para exportar en SHP. Usa GeoJSON o KMZ para este análisis.",
          });
        }

        const buildShp = (rows: any[], geometries: any[]) =>
          new Promise<{ shp: ArrayBuffer; shx: ArrayBuffer; dbf: ArrayBuffer }>((resolve, reject) => {
            shpwriteWrite(rows, "POLYGON", geometries, (err, files) => {
              if (err) return reject(err);
              resolve({ shp: files.shp.buffer, shx: files.shx.buffer, dbf: files.dbf.buffer });
            });
          });

        const zip = new JSZip();
        const sortedPcts = Array.from(groups.keys()).sort((a, b) => a - b);
        for (const pct of sortedPcts) {
          const feats = groups.get(pct)!;
          const geometries = feats.map(orientedCoords);
          const rows = feats.map((f) => ({
            name: String(f.properties?.id ?? f.properties?.individual ?? ""),
            type: String(f.properties?.type ?? analysisType),
            percent: pct,
            area_km2: Number(f.properties?.area_km2 ?? 0),
            analysis: analysisType,
            study: study.name || "",
            start: dateStartStr,
            end: dateEndStr,
          }));

          const files = await buildShp(rows, geometries);
          const base = `percent_${pct}`;
          zip.file(`${base}.shp`, files.shp, { binary: true });
          zip.file(`${base}.shx`, files.shx, { binary: true });
          zip.file(`${base}.dbf`, files.dbf, { binary: true });
          zip.file(`${base}.prj`, prjContent);
          zip.file(`${base}.cpg`, cpgContent);
        }

        const shpBuf = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="geo_${analysisType}_${animalLabel}_${dateStr}_shp.zip"`);
        return res.send(shpBuf);
      }

      return res.status(400).json({ message: "Formato no soportado" });
    } catch (e: any) {
      log(`Export geospatial error: ${e.message}`, "routes");
      return res.status(500).json({ message: `Error al exportar: ${e.message}` });
    }
  });

  app.get("/api/studies", requireAuth, async (req, res) => {
    const user = req.user!;
    let studyList: Study[];
    if (user.role === "superuser") {
      studyList = await storage.getAllStudies();
    } else {
      studyList = await storage.getStudiesForUser(user.id);
    }
    return res.json(studyList.map(maskStudyCredentials));
  });

  app.get("/api/studies/:id", requireStudyAccess, async (req, res) => {
    const study = await storage.getStudy(req.params.id as string);
    if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
    return res.json(maskStudyCredentials(study));
  });

  app.post("/api/studies", requireSuperuser, async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.movebankStudyId || data.movebankStudyId === 0) data.movebankStudyId = null;
      if (!data.movebankUsername) data.movebankUsername = null;
      if (!data.movebankPassword) data.movebankPassword = null;
      const parsed = insertStudySchema.safeParse(data);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }

      // Si el estudio usa Ornitela con credenciales, validarlas contra el panel
      // ANTES de crear el estudio para dar feedback inmediato si son inválidas.
      const ornitelaConfigured = !!(
        parsed.data.ornitelaEnabled &&
        parsed.data.ornitelaUsername &&
        parsed.data.ornitelaPassword
      );
      if (ornitelaConfigured) {
        const panelUrl = parsed.data.ornitelaPanelUrl || "https://cpanel.glosendas.net";
        try {
          await ornitelaSync.login(panelUrl, parsed.data.ornitelaUsername!, parsed.data.ornitelaPassword!);
        } catch (loginErr: any) {
          const msg =
            loginErr instanceof OrnitelaSyncError
              ? loginErr.message
              : `No se pudo conectar con el panel de Ornitela: ${loginErr.message}`;
          return res.status(400).json({ message: msg });
        }
      }

      const study = await storage.createStudy(parsed.data);

      // Allowlist de dispositivos Ornitela indicada en el formulario de creación.
      // Se persiste tras crear el estudio y se reprocesan retroactivamente los
      // archivos SFTP que hubieran quedado sin asignar para esos dispositivos.
      const deviceIds: string[] = Array.isArray(req.body?.ornitelaDeviceIds)
        ? req.body.ornitelaDeviceIds
            .map((d: any) => String(d ?? "").trim())
            .filter((d: string) => d.length > 0)
        : [];
      if (deviceIds.length > 0) {
        const userId = (req.user as any)?.id ?? null;
        for (const deviceId of Array.from(new Set(deviceIds))) {
          try {
            await storage.addOrnitelaDeviceStudy(study.id, deviceId, userId);
            await reprocessUnassignedForDevice(deviceId, study.id);
          } catch (devErr: any) {
            log(`Ornitela allowlist (creación) device ${deviceId}: ${devErr?.message ?? devErr}`, "ornitela");
          }
        }
      }

      // Disparar la primera sincronización en background (fire-and-forget) para
      // que el estudio descubra dispositivos e importe datos sin bloquear la
      // respuesta HTTP.
      if (ornitelaConfigured) {
        setImmediate(() => {
          runOrnitelaFirstSync(study.id).catch((err) =>
            log(`Ornitela primera sincronización (background) error: ${err?.message || err}`, "ornitela"),
          );
        });
      }

      return res.json(maskStudyCredentials(study));
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/studies/:id", requireSuperuser, async (req, res) => {
    const updateData = { ...req.body };
    if (!updateData.movebankUsername || updateData.movebankUsername === "••••••••") {
      delete updateData.movebankUsername;
    }
    if (!updateData.movebankPassword || updateData.movebankPassword === "••••••••") {
      delete updateData.movebankPassword;
    }
    if (!updateData.ornitelaUsername || updateData.ornitelaUsername === "••••••••") {
      delete updateData.ornitelaUsername;
    }
    if (!updateData.ornitelaPassword || updateData.ornitelaPassword === "••••••••") {
      delete updateData.ornitelaPassword;
    }
    const study = await storage.updateStudy(req.params.id, updateData);
    if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
    return res.json(maskStudyCredentials(study));
  });

  app.delete("/api/studies/:id", requireSuperuser, async (req, res) => {
    await storage.deleteStudy(req.params.id);
    return res.json({ ok: true });
  });

  app.get("/api/studies/:id/users", requireSuperuser, async (req, res) => {
    const userIds = await storage.getUsersForStudy(req.params.id);
    return res.json(userIds);
  });

  app.post("/api/studies/:id/users", requireSuperuser, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId requerido" });
    await storage.assignUserToStudy(userId, req.params.id);
    return res.json({ ok: true });
  });

  app.delete("/api/studies/:studyId/users/:userId", requireSuperuser, async (req, res) => {
    await storage.removeUserFromStudy(req.params.userId, req.params.studyId);
    return res.json({ ok: true });
  });

  app.get("/api/individuals/all", requireAuth, async (req, res) => {
    const userId = (req.user as any).id;
    const allIndividuals = await storage.getAllIndividualsForUser(userId);
    return res.json(allIndividuals);
  });

  app.get("/api/studies/:id/last-positions", requireStudyAccess, async (req, res) => {
    try {
      const studyId = req.params.id as string;
      const points = Math.min(Math.max(parseInt(req.query.points as string) || 5, 1), 50);

      const individuals = await storage.getIndividuals(studyId);
      const indMap = new Map(individuals.map(ind => [
        ind.localIdentifier || `ID-${ind.movebankId}`,
        { nickName: ind.nickName || null, ornitelaName: ind.ornitelaName || null, taxon: ind.taxonCanonicalName || null, projectId: ind.projectId || null }
      ]));

      // Devices that have been involved in a manual transfer must be split per
      // animal by deployment window, so a reassigned emitter never shows one
      // animal's last position under another. Legacy devices (no transfer
      // history) keep the original study-wide query untouched.
      const studyDeployments = await storage.getDeviceDeploymentsForStudy(studyId);
      const managedDevices = new Set(studyDeployments.map(d => d.deviceLocalIdentifier));

      const legacyParams: any[] = [studyId, points];
      let excludeClause = "";
      if (managedDevices.size > 0) {
        excludeClause = ` AND individual_local_identifier <> ALL($3::text[])`;
        legacyParams.push(Array.from(managedDevices));
      }

      const { rows: gpsRows } = await pool.query(
        `SELECT individual_local_identifier, timestamp, latitude, longitude, ground_speed, heading, height_above_ellipsoid, hdop
         FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY individual_local_identifier ORDER BY timestamp DESC) AS rn
           FROM cached_gps_events
           WHERE study_id = $1${excludeClause}
         ) sub
         WHERE rn <= $2
         ORDER BY individual_local_identifier, timestamp DESC`,
        legacyParams
      );

      const grouped = new Map<string, any[]>();
      for (const r of gpsRows) {
        const id = r.individual_local_identifier;
        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id)!.push({
          timestamp: Number(r.timestamp),
          latitude: parseFloat(r.latitude),
          longitude: parseFloat(r.longitude),
          groundSpeed: r.ground_speed != null ? parseFloat(r.ground_speed) : null,
          heading: r.heading != null ? parseFloat(r.heading) : null,
          altitude: r.height_above_ellipsoid != null ? parseFloat(r.height_above_ellipsoid) : null,
          hdop: r.hdop != null ? parseFloat(r.hdop) : null,
        });
      }

      // Managed (transferred) animals: query the latest points per animal within
      // its own deployment window(s), keyed by localIdentifier for the current
      // holder or by individualId for animals transferred away (null localId).
      if (managedDevices.size > 0) {
        const byIndividual = new Map<string, { ind: typeof individuals[number] | undefined; rows: typeof studyDeployments }>();
        for (const d of studyDeployments) {
          const entry = byIndividual.get(d.individualId) || { ind: individuals.find(i => i.id === d.individualId), rows: [] as typeof studyDeployments };
          entry.rows.push(d);
          byIndividual.set(d.individualId, entry);
        }
        const nowMs = Date.now();
        for (const [individualId, { ind, rows }] of Array.from(byIndividual)) {
          const fallbackDevice = ind?.localIdentifier ?? null;
          const windows = clipWindows(buildDeviceWindows(rows as any, fallbackDevice), 0, nowMs);
          const key = fallbackDevice ?? individualId;
          const pts: any[] = [];
          for (const w of windows) {
            const { rows: wr } = await pool.query(
              `SELECT timestamp, latitude, longitude, ground_speed, heading, height_above_ellipsoid, hdop
               FROM cached_gps_events
               WHERE study_id = $1 AND individual_local_identifier = $2 AND timestamp >= $3 AND timestamp <= $4
               ORDER BY timestamp DESC LIMIT $5`,
              [studyId, w.device, Math.floor(w.startMs), Math.ceil(w.endMs), points]
            );
            for (const r of wr) {
              pts.push({
                timestamp: Number(r.timestamp),
                latitude: parseFloat(r.latitude),
                longitude: parseFloat(r.longitude),
                groundSpeed: r.ground_speed != null ? parseFloat(r.ground_speed) : null,
                heading: r.heading != null ? parseFloat(r.heading) : null,
                altitude: r.height_above_ellipsoid != null ? parseFloat(r.height_above_ellipsoid) : null,
                hdop: r.hdop != null ? parseFloat(r.hdop) : null,
              });
            }
          }
          if (pts.length > 0) {
            pts.sort((a, b) => b.timestamp - a.timestamp);
            grouped.set(key, pts.slice(0, points));
            if (!indMap.has(key)) {
              indMap.set(key, {
                nickName: ind?.nickName || null,
                ornitelaName: ind?.ornitelaName || null,
                taxon: ind?.taxonCanonicalName || null,
                projectId: ind?.projectId || null,
              });
            }
          }
        }
      }

      const result: any[] = [];
      let withData = 0;
      let globalLastUpdate: number | null = null;

      const identifiersWithData = new Set<string>();
      for (const [id, pts] of Array.from(grouped)) {
        identifiersWithData.add(id);
        withData++;
        const lastTs = pts[0].timestamp;
        if (!globalLastUpdate || lastTs > globalLastUpdate) globalLastUpdate = lastTs;

        const meta = indMap.get(id) || { nickName: null, ornitelaName: null, taxon: null, projectId: null };
        result.push({
          individual: id,
          nickName: meta.nickName,
          ornitelaName: meta.ornitelaName,
          taxon: meta.taxon,
          projectId: meta.projectId,
          points: pts,
        });
      }

      const withoutData = Math.max(0, individuals.length - withData);

      return res.json({
        summary: {
          totalIndividuals: individuals.length,
          withData,
          withoutData,
          lastUpdate: globalLastUpdate,
        },
        animals: result,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/studies/:id/individuals", requireStudyAccess, async (req, res) => {
    const individuals = await storage.getIndividuals(req.params.id as string);
    return res.json(individuals);
  });

  app.get("/api/studies/:id/gps-counts", requireStudyAccess, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT individual_local_identifier,
                COUNT(*)::int AS count,
                MAX(timestamp)::bigint AS last_timestamp
         FROM cached_gps_events
         WHERE study_id = $1
         GROUP BY individual_local_identifier`,
        [req.params.id]
      );
      const counts: Record<string, { count: number; lastTimestamp: number | null }> = {};
      for (const r of rows) {
        counts[r.individual_local_identifier] = {
          count: r.count,
          lastTimestamp: r.last_timestamp != null ? Number(r.last_timestamp) : null,
        };
      }
      return res.json(counts);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/studies/:id/gps-point-count", requireStudyAccess, async (req, res) => {
    try {
      const individuals = String(req.query.individuals ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const start = Number(req.query.start);
      const end = Number(req.query.end);
      if (individuals.length === 0 || !Number.isFinite(start) || !Number.isFinite(end)) {
        return res.json({ count: 0, maxPerAnimal: 0 });
      }
      const { rows } = await pool.query(
        `SELECT individual_local_identifier AS individual, COUNT(*)::int AS count
         FROM cached_gps_events
         WHERE study_id = $1
           AND individual_local_identifier = ANY($2::text[])
           AND timestamp >= $3 AND timestamp <= $4
           AND latitude IS NOT NULL AND longitude IS NOT NULL
         GROUP BY individual_local_identifier`,
        [req.params.id, individuals, start, end]
      );
      let total = 0;
      let maxPerAnimal = 0;
      for (const r of rows) {
        const c = Number(r.count) || 0;
        total += c;
        if (c > maxPerAnimal) maxPerAnimal = c;
      }
      // El submuestreo del análisis se aplica por animal, así que maxPerAnimal
      // determina si el filtro estará activo.
      return res.json({ count: total, maxPerAnimal });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/studies/:id/deployments", requireStudyAccess, async (req, res) => {
    const deployments = await storage.getDeployments(req.params.id as string);
    return res.json(deployments);
  });

  async function userHasDeviceAccess(userId: string, role: string, deviceId: string): Promise<boolean> {
    if (role === "superuser") return true;
    const studyId = await storage.findStudyIdForDeviceId(deviceId);
    if (!studyId) return false;
    const userStudyIds = (await storage.getStudiesForUser(userId)).map((s) => s.id);
    return userStudyIds.includes(studyId);
  }

  function parseFiniteNumber(v: unknown): number | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(Array.isArray(v) ? v[0] : v);
    return Number.isFinite(n) ? n : undefined;
  }

  app.get("/api/acc-labels", requireAuth, async (req, res) => {
    const deviceId = String(req.query.deviceId || "").trim();
    if (!deviceId) return res.status(400).json({ message: "deviceId requerido" });
    const user = req.user!;
    if (!(await userHasDeviceAccess(user.id, user.role, deviceId))) {
      return res.status(403).json({ message: "Sin acceso a este dispositivo" });
    }
    const startTs = parseFiniteNumber(req.query.start);
    const endTs = parseFiniteNumber(req.query.end);
    const rows = await storage.getAccelerometerLabels(deviceId, startTs, endTs);
    return res.json(rows);
  });

  app.post("/api/acc-labels", checkRole("superuser", "user"), async (req, res) => {
    try {
      const parsed = insertAccelerometerLabelSchema.parse(req.body);
      const user = req.user!;
      if (!(await userHasDeviceAccess(user.id, user.role, parsed.deviceId))) {
        return res.status(403).json({ message: "Sin acceso a este dispositivo" });
      }
      const created = await storage.createAccelerometerLabel({ ...parsed, createdBy: user.id });
      return res.json(created);
    } catch (e: any) {
      return res.status(400).json({ message: e?.message || "Datos invalidos" });
    }
  });

  app.get("/api/individuals/:id/device-deployments", requireAuth, async (req, res) => {
    const ind = await storage.getIndividualById(req.params.id);
    if (!ind) return res.status(404).json({ message: "Animal no encontrado" });
    const user = req.user!;
    if (user.role !== "superuser") {
      const userStudyIds = (await storage.getStudiesForUser(user.id)).map((s) => s.id);
      if (!userStudyIds.includes(ind.studyId)) {
        return res.status(403).json({ message: "Sin acceso a este animal" });
      }
    }
    const rows = await storage.getDeviceDeploymentsForIndividual(req.params.id);
    return res.json(rows);
  });

  app.get("/api/studies/:id/device-deployments", requireStudyAccess, async (req, res) => {
    const rows = await storage.getDeviceDeploymentsForStudy(req.params.id as string);
    return res.json(rows);
  });

  app.post("/api/device-transfers", checkRole("superuser"), async (req, res) => {
    try {
      const parsed = deviceTransferSchema.parse(req.body);
      const transferDate = new Date(parsed.transferDate);
      if (Number.isNaN(transferDate.getTime())) {
        return res.status(400).json({ message: "Fecha de transferencia inválida" });
      }
      const result = await storage.transferDevice({
        fromIndividualId: parsed.fromIndividualId,
        toIndividualId: parsed.toIndividualId,
        deviceLocalIdentifier: parsed.deviceLocalIdentifier,
        transferDate,
        notes: parsed.notes ?? null,
        createdBy: req.user!.id,
      });
      return res.json(result);
    } catch (e: any) {
      return res.status(400).json({ message: e?.message || "Datos inválidos" });
    }
  });

  app.delete("/api/acc-labels/:id", checkRole("superuser", "user"), async (req, res) => {
    const existing = await storage.getAccelerometerLabel(req.params.id);
    if (!existing) return res.status(404).json({ message: "Etiqueta no encontrada" });
    const user = req.user!;
    if (user.role !== "superuser" && existing.createdBy !== user.id) {
      if (!(await userHasDeviceAccess(user.id, user.role, existing.deviceId))) {
        return res.status(403).json({ message: "Sin permiso para eliminar esta etiqueta" });
      }
    }
    const ok = await storage.deleteAccelerometerLabel(req.params.id);
    if (!ok) return res.status(404).json({ message: "Etiqueta no encontrada" });
    return res.json({ success: true });
  });

  app.patch("/api/individuals/:id", checkRole("superuser", "user"), async (req, res) => {
    try {
      const { nickName, taxonCanonicalName, sex, animalLifeStage, projectId, historyNumber, project_id, history_number } = req.body;
      const resolvedProjectId = projectId !== undefined ? projectId : project_id;
      const resolvedHistoryNumber = historyNumber !== undefined ? historyNumber : history_number;
      const updated = await storage.updateIndividual(req.params.id, {
        ...(nickName !== undefined && { nickName }),
        ...(taxonCanonicalName !== undefined && { taxonCanonicalName }),
        ...(sex !== undefined && { sex }),
        ...(animalLifeStage !== undefined && { animalLifeStage }),
        ...(resolvedProjectId !== undefined && { projectId: resolvedProjectId === null || resolvedProjectId === "" ? null : Number(resolvedProjectId) }),
        ...(resolvedHistoryNumber !== undefined && { historyNumber: (typeof resolvedHistoryNumber === "string" ? resolvedHistoryNumber.trim() : resolvedHistoryNumber) || null }),
      });
      if (!updated) return res.status(404).json({ message: "Individuo no encontrado" });
      return res.json(updated);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/individuals/:id/active-status", requireSuperuser, async (req, res) => {
    try {
      const { isActive } = req.body;
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ message: "isActive (boolean) es requerido" });
      }
      const updated = await storage.setIndividualActiveStatus(req.params.id as string, isActive);
      if (!updated) return res.status(404).json({ message: "Individuo no encontrado" });
      log(`Animal ${updated.localIdentifier ?? updated.id} marcado como ${isActive ? "activo" : "inactivo"} por ${(req.user as any)?.email}`, "events");
      return res.json(updated);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/deployments/:id", requireSuperuser, async (req, res) => {
    try {
      const { deployOff } = req.body;
      const updated = await storage.updateDeploymentStatus(req.params.id, {
        deployOff: deployOff || null,
      });
      if (!updated) return res.status(404).json({ message: "Deployment no encontrado" });
      return res.json(updated);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/studies/:id/deployments", requireSuperuser, requireStudyAccess, async (req, res) => {
    try {
      const { individualMovebankId, deployOn, deployOff } = req.body;
      if (!individualMovebankId || !deployOn) {
        return res.status(400).json({ message: "individualMovebankId y deployOn son requeridos" });
      }
      const dep = await storage.createDeploymentForIndividual({
        studyId: req.params.id as string,
        movebankId: Math.floor(Date.now() + Math.random() * 10000),
        individualId: individualMovebankId,
        deployOn,
        deployOff: deployOff || null,
      });
      return res.json(dep);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/studies/:id/events", movebankLimiter, requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const { individuals: individualIds, sensor_type, timestamp_start, timestamp_end, force } = req.query;
      if (!individualIds || !sensor_type || !timestamp_start || !timestamp_end) {
        return res.status(400).json({ message: "Parámetros requeridos: individuals, sensor_type, timestamp_start, timestamp_end" });
      }

      const sensorTypeId = parseInt(sensor_type as string, 10);
      if (sensorTypeId !== 653 && sensorTypeId !== 2365683) {
        return res.status(400).json({ message: "sensor_type_id inválido. Use 653 para GPS o 2365683 para acelerómetro." });
      }
      const tsStart = parseInt(timestamp_start as string, 10);
      const tsEnd = parseInt(timestamp_end as string, 10);
      const ids = (individualIds as string).split(",");
      const forceReload = force === "true";
      const isGps = sensorTypeId === 653;
      const isAcc = sensorTypeId === 2365683;
      const hasMovebank = hasMovebankCredentials(study);

      const results: Record<string, Record<string, string>[]> = {};

      const formatGpsCache = (cached: any[], id: string) => cached.map((c: any) => ({
        timestamp: new Date(c.timestamp).toISOString(),
        location_lat: String(c.latitude),
        location_long: String(c.longitude),
        ground_speed: c.groundSpeed != null ? String(c.groundSpeed) : "",
        heading: c.heading != null ? String(c.heading) : "",
        height_above_ellipsoid: c.heightAboveEllipsoid != null ? String(c.heightAboveEllipsoid) : "",
        hdop: c.hdop != null ? String(c.hdop) : "",
        individual_local_identifier: id,
      }));

      const formatAccCache = (cached: any[], id: string) => cached.map((c: any) => ({
        timestamp: new Date(c.timestamp).toISOString(),
        acceleration_x: String(c.xAcceleration),
        acceleration_y: String(c.yAcceleration),
        acceleration_z: String(c.zAcceleration),
        individual_local_identifier: id,
        ...(c.rawData ? { accelerations_raw: c.rawData } : {}),
      }));

      const cacheMovebankGps = (rows: Record<string, string>[], trimmed: string) =>
        rows
          .filter((r) => r.location_lat && r.location_long)
          .map((r) => ({
            studyId: study.id,
            individualLocalIdentifier: trimmed,
            timestamp: new Date(r.timestamp).getTime(),
            latitude: parseFloat(r.location_lat),
            longitude: parseFloat(r.location_long),
            groundSpeed: r.ground_speed ? parseFloat(r.ground_speed) : null,
            heading: r.heading ? parseFloat(r.heading) : null,
            heightAboveEllipsoid: r.height_above_ellipsoid ? parseFloat(r.height_above_ellipsoid) : null,
            hdop: null,
          }))
          .filter((p) => !isNaN(p.timestamp) && !isNaN(p.latitude) && !isNaN(p.longitude));

      const cacheMovebankAcc = (rows: Record<string, string>[], trimmed: string) => {
        const toCache: { studyId: string; individualLocalIdentifier: string; timestamp: number; xAcceleration: number; yAcceleration: number; zAcceleration: number; rawData: string | null }[] = [];
        for (const r of rows) {
          const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
          const ts = new Date(r.timestamp).getTime();
          if (isNaN(ts)) continue;
          if (rawAxes) {
            const vals = rawAxes.split(/\s+/).map(Number);
            for (let i = 0; i + 2 < vals.length; i += 3) {
              if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
                toCache.push({
                  studyId: study.id,
                  individualLocalIdentifier: trimmed,
                  timestamp: ts + i * 10,
                  xAcceleration: vals[i],
                  yAcceleration: vals[i + 1],
                  zAcceleration: vals[i + 2],
                  rawData: i === 0 ? rawAxes : null,
                });
              }
            }
          } else {
            toCache.push({
              studyId: study.id,
              individualLocalIdentifier: trimmed,
              timestamp: ts,
              xAcceleration: parseFloat(r.acceleration_x || "0"),
              yAcceleration: parseFloat(r.acceleration_y || "0"),
              zAcceleration: parseFloat(r.acceleration_z || "0"),
              rawData: null,
            });
          }
        }
        return toCache;
      };

      for (const animalId of ids) {
          const trimmed = animalId.trim();
          const sensorKey = isGps ? "gps" as const : "acc" as const;

          // Resolve which device(s) and time window(s) this animal actually
          // carried, so an emitter reassigned between animals doesn't leak data
          // across periods. `trimmed` may be a current localIdentifier (current
          // holder) or an individualId (an animal that was transferred away and
          // no longer has a device assigned).
          let resolvedInd = await storage.getIndividualByLocalIdentifier(study.id, trimmed);
          let isHistorical = false;
          if (!resolvedInd) {
            const byId = await storage.getIndividualById(trimmed);
            if (byId && byId.studyId === study.id) { resolvedInd = byId; isHistorical = true; }
          }
          const deps = resolvedInd ? await storage.getDeviceDeploymentsForIndividual(resolvedInd.id) : [];
          const rawWindows = buildDeviceWindows(deps, isHistorical ? null : trimmed);
          const windows = clipWindows(rawWindows, tsStart, tsEnd);
          const canFetchMovebank = hasMovebank && !isHistorical;

          const readClippedGps = () => storage.getCachedGpsEventsForWindows(study.id, windows);
          const readClippedAcc = () => storage.getCachedAccEventsForWindows(study.id, windows);

          try {
            if (isHistorical) {
              // Historical animal: device data is cached under the device's
              // localIdentifier (currently held by another animal and synced
              // there). Just read the clipped cache; never fetch by UUID.
              if (isGps) {
                results[trimmed] = formatGpsCache(await readClippedGps(), trimmed);
              } else {
                results[trimmed] = formatAccCache(await readClippedAcc(), trimmed);
              }
              log(`Historical read for ${trimmed} (${sensorKey}) - ${results[trimmed].length} records`, "cache");
              continue;
            }

            if (forceReload && canFetchMovebank) {
              const events = await fetchMovebankEvents(
                study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!,
                trimmed, sensorTypeId, tsStart, tsEnd
              );
              await movebankDelay();
              if (isGps) {
                await storage.insertCachedGpsEvents(cacheMovebankGps(events, trimmed));
              } else {
                await storage.insertCachedAccEvents(cacheMovebankAcc(events, trimmed));
              }
              log(`Force-cached ${events.length} ${sensorKey} records for ${trimmed}`, "cache");
              await storage.recordFetchedRange(study.id, trimmed, sensorKey, tsStart, tsEnd);

              if (isGps) {
                results[trimmed] = formatGpsCache(await readClippedGps(), trimmed);
              } else {
                results[trimmed] = formatAccCache(await readClippedAcc(), trimmed);
              }
              continue;
            }

            const gaps = await storage.computeUncoveredGaps(study.id, trimmed, sensorKey, tsStart, tsEnd);

            if (gaps.length === 0) {
              if (isGps) {
                results[trimmed] = formatGpsCache(await readClippedGps(), trimmed);
              } else {
                results[trimmed] = formatAccCache(await readClippedAcc(), trimmed);
              }
              log(`Cache HIT for ${trimmed} (${sensorKey}) - ${results[trimmed].length} records`, "cache");
              continue;
            }

            if (canFetchMovebank) {
              let movebankRows: Record<string, string>[] = [];
              for (const gap of gaps) {
                const rows = await fetchMovebankEvents(
                  study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!,
                  trimmed, sensorTypeId, gap.start, gap.end
                );
                movebankRows = movebankRows.concat(rows);
                await movebankDelay();
              }

              if (movebankRows.length > 0) {
                if (isGps) {
                  await storage.insertCachedGpsEvents(cacheMovebankGps(movebankRows, trimmed));
                } else {
                  await storage.insertCachedAccEvents(cacheMovebankAcc(movebankRows, trimmed));
                }
                log(`Cached ${movebankRows.length} new ${sensorKey} records for ${trimmed}`, "cache");
              }

              for (const gap of gaps) {
                await storage.recordFetchedRange(study.id, trimmed, sensorKey, gap.start, gap.end);
              }
            }

            if (isGps) {
              results[trimmed] = formatGpsCache(await readClippedGps(), trimmed);
            } else {
              results[trimmed] = formatAccCache(await readClippedAcc(), trimmed);
            }
            log(`Returning ${results[trimmed].length} ${sensorKey} records for ${trimmed} (gaps: ${gaps.length}, movebank: ${hasMovebank})`, "cache");
          } catch (e: any) {
            log(`Events fetch error for ${trimmed}: ${e.message}`, "movebank");
            if (isGps) {
              results[trimmed] = formatGpsCache(await readClippedGps(), trimmed);
            } else {
              results[trimmed] = formatAccCache(await readClippedAcc(), trimmed);
            }
            log(`Fallback to cache for ${trimmed}: ${results[trimmed].length} records`, "cache");
          }
      }

      return res.json(results);
    } catch (e: any) {
      log(`Events error: ${e.message}`, "movebank");
      return res.status(500).json({ message: `Error al obtener eventos: ${e.message}` });
    }
  });

  // Species profiles CRUD
  app.get("/api/species-profiles", requireAuth, async (_req, res) => {
    const profiles = await storage.getAllSpeciesProfiles();
    return res.json(profiles);
  });

  app.get("/api/species-profiles/:id", requireAuth, async (req, res) => {
    const profile = await storage.getSpeciesProfile(req.params.id);
    if (!profile) return res.status(404).json({ message: "Perfil no encontrado" });
    return res.json(profile);
  });

  app.post("/api/species-profiles", requireSuperuser, async (req, res) => {
    try {
      const parsed = insertSpeciesProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }
      const profile = await storage.createSpeciesProfile(parsed.data);
      return res.json(profile);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/species-profiles/:id", requireSuperuser, async (req, res) => {
    const profile = await storage.updateSpeciesProfile(req.params.id, req.body);
    if (!profile) return res.status(404).json({ message: "Perfil no encontrado" });
    return res.json(profile);
  });

  app.delete("/api/species-profiles/:id", requireSuperuser, async (req, res) => {
    await storage.deleteSpeciesProfile(req.params.id);
    return res.json({ ok: true });
  });

  app.get("/api/species", requireAuth, async (_req, res) => {
    const all = await storage.getAllSpecies();
    const projectCounts = await storage.getProjectCountsBySpecies();
    const enriched = all.map(sp => ({
      ...sp,
      projectCount: projectCounts[sp.id] || 0,
    }));
    return res.json(enriched);
  });

  app.post("/api/species", requireSuperuser, async (req, res) => {
    try {
      const parsed = insertSpeciesSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      const created = await storage.createSpecies(parsed.data);
      return res.json(created);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/species/:id", requireSuperuser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
    const updated = await storage.updateSpecies(id, req.body);
    if (!updated) return res.status(404).json({ message: "Especie no encontrada" });
    return res.json(updated);
  });

  app.delete("/api/species/:id", requireSuperuser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
    await storage.deleteSpecies(id);
    return res.json({ ok: true });
  });

  app.get("/api/projects", requireAuth, async (_req, res) => {
    const all = await storage.getAllProjects();
    const animalCounts = await storage.getIndividualCountsByProject();
    const enriched = all.map(proj => ({
      ...proj,
      animalCount: animalCounts[proj.id] || 0,
    }));
    return res.json(enriched);
  });

  app.post("/api/projects", requireSuperuser, async (req, res) => {
    try {
      const parsed = insertProjectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      const created = await storage.createProject(parsed.data);
      return res.json(created);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/projects/:id", requireSuperuser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
    const updated = await storage.updateProject(id, req.body);
    if (!updated) return res.status(404).json({ message: "Proyecto no encontrado" });
    return res.json(updated);
  });

  app.delete("/api/projects/:id", requireSuperuser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
    await storage.deleteProject(id);
    return res.json({ ok: true });
  });

  app.post("/api/admin/import-reference-data", requireSuperuser, async (_req, res) => {
    try {
      const SEED_SPECIES = [
        { nombreComun: "Águila real", nombreCientifico: "Aquila chrysaetos" },
        { nombreComun: "Águila imperial ibérica", nombreCientifico: "Aquila adalberti" },
        { nombreComun: "Águila perdicera", nombreCientifico: "Aquila fasciata" },
        { nombreComun: "Águila pescadora", nombreCientifico: "Pandion haliaetus" },
        { nombreComun: "Águila calzada", nombreCientifico: "Hieraaetus pennatus" },
        { nombreComun: "Águila culebrera", nombreCientifico: "Circaetus gallicus" },
        { nombreComun: "Buitre negro", nombreCientifico: "Aegypius monachus" },
        { nombreComun: "Buitre leonado", nombreCientifico: "Gyps fulvus" },
        { nombreComun: "Alimoche", nombreCientifico: "Neophron percnopterus" },
        { nombreComun: "Quebrantahuesos", nombreCientifico: "Gypaetus barbatus" },
        { nombreComun: "Milano real", nombreCientifico: "Milvus milvus" },
        { nombreComun: "Milano negro", nombreCientifico: "Milvus migrans" },
        { nombreComun: "Búho real", nombreCientifico: "Bubo bubo" },
        { nombreComun: "Cigüeña negra", nombreCientifico: "Ciconia nigra" },
        { nombreComun: "Cigüeña blanca", nombreCientifico: "Ciconia ciconia" },
        { nombreComun: "Cernícalo primilla", nombreCientifico: "Falco naumanni" },
        { nombreComun: "Halcón peregrino", nombreCientifico: "Falco peregrinus" },
        { nombreComun: "Azor común", nombreCientifico: "Accipiter gentilis" },
        { nombreComun: "Gavilán", nombreCientifico: "Accipiter nisus" },
        { nombreComun: "Busardo ratonero", nombreCientifico: "Buteo buteo" },
        { nombreComun: "Aguilucho lagunero", nombreCientifico: "Circus aeruginosus" },
        { nombreComun: "Aguilucho cenizo", nombreCientifico: "Circus pygargus" },
        { nombreComun: "Aguilucho pálido", nombreCientifico: "Circus cyaneus" },
        { nombreComun: "Lechuza común", nombreCientifico: "Tyto alba" },
        { nombreComun: "Mochuelo europeo", nombreCientifico: "Athene noctua" },
        { nombreComun: "Cárabo común", nombreCientifico: "Strix aluco" },
        { nombreComun: "Autillo europeo", nombreCientifico: "Otus scops" },
        { nombreComun: "Elanio azul", nombreCientifico: "Elanus caeruleus" },
        { nombreComun: "Avutarda", nombreCientifico: "Otis tarda" },
        { nombreComun: "Sisón", nombreCientifico: "Tetrax tetrax" },
        { nombreComun: "Grulla común", nombreCientifico: "Grus grus" },
      ];

      const SEED_PROJECTS = [
        "Tendidos eléctricos", "Venenos", "Atropellos", "Disparos",
        "Electrocuciones y colisiones", "Rehabilitación general", "Cría en cautividad",
        "Reintroducción Águila imperial", "Reintroducción Águila perdicera",
        "Reintroducción Buitre negro", "Reintroducción Quebrantahuesos",
        "Reintroducción Alimoche", "Reintroducción Águila pescadora",
        "Seguimiento Milano real", "Seguimiento Cigüeña negra",
        "Seguimiento Búho real", "Seguimiento Águila real",
        "Seguimiento Cernícalo primilla", "Seguimiento Halcón peregrino",
        "Seguimiento Buitre leonado", "Seguimiento Buitre negro",
        "Hacking Águila imperial", "Hacking Águila perdicera",
        "Hacking Buitre negro", "Hacking Quebrantahuesos",
        "Marcaje científico", "Estudio migratorio", "Estudio reproductivo",
        "Conservación hábitat", "Estudio ecotoxicología", "Control sanitario",
        "Estudio genético poblacional", "Telemetría experimental",
        "Estudio comportamiento", "Evaluación impacto ambiental",
        "Estudio dieta y alimentación", "Censo y monitoreo poblacional",
        "Estudio dispersión juvenil", "Programa de apadrinamiento",
        "Seguimiento post-liberación", "Estudio mortalidad no natural",
        "Investigación enfermedades", "Plan de recuperación de especie",
        "Educación ambiental", "Cooperación internacional",
        "Estudio cambio climático", "Monitoreo áreas protegidas",
        "Evaluación conectividad ecológica", "Seguimiento especies invasoras",
        "Estudio urbanización fauna", "Programa voluntariado científico",
        "Análisis paisaje y uso del suelo", "Mapeo corredores biológicos",
        "Gestión conflicto humano-fauna", "Rehabilitación y suelta",
        "Identificación zonas sensibles", "Seguimiento colonias",
        "Estudio contaminación lumínica", "Desarrollo protocolos veterinarios",
        "Banco genético", "Estudio bioacústica",
      ];

      const existingSpecies = await storage.getAllSpecies();
      const existingNames = new Set(existingSpecies.map(s => s.nombreCientifico));
      let speciesInserted = 0;
      for (const sp of SEED_SPECIES) {
        if (!existingNames.has(sp.nombreCientifico)) {
          await storage.createSpecies(sp);
          speciesInserted++;
        }
      }

      const existingProjects = await storage.getAllProjects();
      const existingDescs = new Set(existingProjects.map(p => p.descripcion));
      let projectsInserted = 0;
      for (const desc of SEED_PROJECTS) {
        if (!existingDescs.has(desc)) {
          await storage.createProject({ descripcion: desc, idEspecie: null });
          projectsInserted++;
        }
      }

      return res.json({
        ok: true,
        speciesInserted,
        speciesSkipped: SEED_SPECIES.length - speciesInserted,
        projectsInserted,
        projectsSkipped: SEED_PROJECTS.length - projectsInserted,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // Detected events
  app.get("/api/studies/:id/detected-events", requireStudyAccess, async (req, res) => {
    const { timestamp_start, timestamp_end } = req.query;
    const tsStart = timestamp_start ? parseInt(timestamp_start as string, 10) : undefined;
    const tsEnd = timestamp_end ? parseInt(timestamp_end as string, 10) : undefined;
    const events = await storage.getDetectedEvents(req.params.id as string, tsStart, tsEnd);
    return res.json(events);
  });

  // Detect events (trigger analysis)
  app.post("/api/studies/:id/detect-events", checkRole("superuser", "user"), movebankLimiter, requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const { individuals: individualIds, timestamp_start, timestamp_end } = req.body;
      if (!individualIds || !timestamp_start || !timestamp_end) {
        return res.status(400).json({ message: "Parámetros requeridos: individuals, timestamp_start, timestamp_end" });
      }

      let thresholds: EventThresholds = { ...DEFAULT_THRESHOLDS };
      if (study.speciesProfileId) {
        const profile = await storage.getSpeciesProfile(study.speciesProfileId);
        if (profile) {
          thresholds = normalizeThresholds(profile.thresholds);
        }
      }

      const ids = (individualIds as string).split(",").map((s: string) => s.trim());
      const tsStart = parseInt(timestamp_start as string, 10);
      const tsEnd = parseInt(timestamp_end as string, 10);

      // Animales marcados como inactivos no generan alertas nuevas.
      // El token puede ser el localIdentifier del titular actual o el id (UUID)
      // de un animal transferido, así que se incluyen ambos en el set.
      const studyInds = await storage.getIndividuals(study.id);
      const inactiveIds = new Set<string>();
      for (const i of studyInds) {
        if (i.isActive === false) {
          inactiveIds.add(i.id);
          if (i.localIdentifier) inactiveIds.add(i.localIdentifier);
        }
      }

      let totalEvents = 0;
      let emailsSent = 0;

      for (const animalId of ids) {
        if (inactiveIds.has(animalId)) {
          log(`Detección omitida para ${animalId}: animal inactivo`, "events");
          continue;
        }
        try {
          const cachedGps = await clippedGpsFor(study.id, animalId, tsStart, tsEnd);
          const cachedAcc = await clippedAccFor(study.id, animalId, tsStart, tsEnd);

          const gpsSamples = cachedGps.map((c) => ({
            timestamp: c.timestamp,
            lat: c.latitude,
            lng: c.longitude,
          })).filter((p) => !isNaN(p.lat) && !isNaN(p.lng) && !isNaN(p.timestamp));

          const accSamples: { timestamp: number; x: number; y: number; z: number }[] = cachedAcc.map((c) => ({
            timestamp: c.timestamp,
            x: c.xAcceleration,
            y: c.yAcceleration,
            z: c.zAcceleration,
          }));

          const detected = detectEvents(accSamples, gpsSamples, thresholds, study.id, animalId, { ornitelaOnly: study.ornitelaEnabled === true });

          const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
          const sinceCreatedAt = Date.now() - DEDUPE_WINDOW_MS;

          for (const event of detected) {
            if (
              event.eventType === "low_activity" ||
              event.eventType === "electrocution" ||
              event.eventType === "predation_fight" ||
              event.eventType === "transmitter_fall_risk"
            ) {
              const recent = await storage.findRecentUnresolvedDetectedEvent(study.id, event.individualLocalId, event.eventType, sinceCreatedAt);
              if (recent) continue;
              if (event.eventType === "low_activity") {
                const openMortality = await storage.findRecentUnresolvedDetectedEvent(study.id, event.individualLocalId, "mortality", sinceCreatedAt);
                if (openMortality) continue;
              }
            }

            const saved = await storage.createDetectedEvent(event);
            totalEvents++;

            if (study.alertEmail && (event.severity === "critical" || event.severity === "high")) {
              const alreadySent = await storage.getAlertLog(saved.id, study.alertEmail);
              if (!alreadySent) {
                const sent = await sendEventAlert(saved, study.alertEmail, study.name);
                if (sent) {
                  await storage.createAlertLog(saved.id, study.alertEmail);
                  emailsSent++;
                }
              }
            }
          }

          log(`Detected ${detected.length} events for ${animalId}`, "events");
        } catch (e: any) {
          log(`Event detection error for ${animalId}: ${e.message}`, "events");
          if (e instanceof MovebankError && e.statusCode === 429) {
            return res.status(429).json({ message: e.message });
          }
        }
      }

      return res.json({ totalEvents, emailsSent });
    } catch (e: any) {
      log(`Event detection error: ${e.message}`, "events");
      if (e instanceof MovebankError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
      return res.status(500).json({ message: `Error al detectar eventos: ${e.message}` });
    }
  });

  // Emission monitor - check which active animals have stopped emitting
  app.get("/api/monitor/emissions", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const days = parseInt(req.query.days as string, 10) || 3;
      const now = Date.now();

      const studiesWithAnimals = await storage.getActiveStudiesWithDeployments();

      let accessibleStudies = studiesWithAnimals;
      if (user.role !== "superuser") {
        const userStudyIds = (await storage.getStudiesForUser(user.id)).map((s) => s.id);
        accessibleStudies = studiesWithAnimals.filter((s) => userStudyIds.includes(s.study.id));
      }

      const results: {
        animalId: string;
        studyName: string;
        studyId: string;
        lastEmission: number | null;
        daysSilent: number | null;
        lat: number | null;
        lng: number | null;
      }[] = [];

      // Lee la última posición GPS desde la caché local (cached_gps_events), poblada
      // por el sync SFTP de Ornitela (~2 min) y el backfill de Movebank. NO se llama a
      // la API de Movebank, por lo que no hay límite de peticiones diarias.
      for (const { study, activeIndividuals } of accessibleStudies) {
        for (const animal of activeIndividuals) {
          try {
            const latest = await storage.getLatestCachedGpsEventAnyQuality(study.id, animal.localIdentifier);
            const lastTs = latest ? latest.timestamp : null;
            const lastLat = latest ? latest.latitude : null;
            const lastLng = latest ? latest.longitude : null;

            const daysSilent = lastTs ? Math.floor((now - lastTs) / (24 * 60 * 60 * 1000)) : null;

            if (daysSilent === null || daysSilent >= days) {
              results.push({
                animalId: animal.localIdentifier,
                studyName: study.name,
                studyId: study.id,
                lastEmission: lastTs,
                daysSilent,
                lat: lastLat,
                lng: lastLng,
              });
            }
          } catch (e: any) {
            log(`Emission check error for ${animal.localIdentifier}: ${e.message}`, "monitor");
            results.push({
              animalId: animal.localIdentifier,
              studyName: study.name,
              studyId: study.id,
              lastEmission: null,
              daysSilent: null,
              lat: null,
              lng: null,
            });
          }
        }
      }

      results.sort((a, b) => (b.daysSilent ?? 9999) - (a.daysSilent ?? 9999));

      return res.json(results);
    } catch (e: any) {
      log(`Emission monitor error: ${e.message}`, "monitor");
      return res.status(500).json({ message: `Error en monitor de emision: ${e.message}` });
    }
  });

  // Emission alerts CRUD
  app.get("/api/emission-alerts", requireAuth, async (req, res) => {
    const alerts = await storage.getEmissionAlertsForUser(req.user!.id);
    return res.json(alerts);
  });

  app.post("/api/emission-alerts", checkRole("superuser", "user"), async (req, res) => {
    try {
      const parsed = insertEmissionAlertSchema.safeParse({
        ...req.body,
        userId: req.user!.id,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos invalidos" });
      }
      const alert = await storage.createEmissionAlert(parsed.data);
      return res.json(alert);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/emission-alerts/:id", checkRole("superuser", "user"), async (req, res) => {
    const alert = await storage.updateEmissionAlert(req.params.id, req.body);
    if (!alert) return res.status(404).json({ message: "Alerta no encontrada" });
    return res.json(alert);
  });

  app.delete("/api/emission-alerts/:id", checkRole("superuser", "user"), async (req, res) => {
    await storage.deleteEmissionAlert(req.params.id);
    return res.json({ ok: true });
  });

  app.post("/api/studies/:id/sync", checkRole("superuser"), movebankLimiter, requireStudyAccess, async (req, res) => {
    try {
      const blockCheck = movebankRateLimiter.isBlocked();
      if (blockCheck.blocked) {
        return res.status(429).json({ message: blockCheck.reason, blockedUntil: blockCheck.blockedUntil?.toISOString() });
      }

      log(`Sync iniciado para estudio: ${req.params.id}`, "movebank");
      const study = await storage.getStudyDecrypted(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      if (!hasMovebankCredentials(study)) {
        return res.status(400).json({ message: "Este estudio no tiene credenciales de Movebank configuradas" });
      }

      log(`Conectando con Movebank, study_id: ${study.movebankStudyId}, estudio: ${study.name}`, "movebank");

      const rawIndividuals = await fetchMovebankIndividuals(study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!);
      log(`Movebank respondió individuos: ${rawIndividuals.length}`, "movebank");

      await movebankDelay();

      const rawDeployments = await fetchMovebankDeployments(study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!);
      await movebankDelay();
      const depIndMap = await fetchMovebankDeploymentIndividualMap(study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!);
      log(`Movebank respondió despliegues: ${rawDeployments.length}, mappings evento→individuo: ${depIndMap.size}`, "movebank");

      const individualsData = rawIndividuals.map((r) => ({
        studyId: study.id,
        movebankId: parseInt(r.id || r.individual_id || "0", 10),
        localIdentifier: r.local_identifier || null,
        nickName: r.nick_name || null,
        taxonCanonicalName: r.taxon_canonical_name || null,
        sex: r.sex || null,
        animalLifeStage: r.animal_life_stage || null,
        synced: true,
        ornitelaName: null,
        projectId: null,
        historyNumber: null,
      }));

      const deploymentsData = rawDeployments.map((r) => {
        const depMovebankId = r.id || r.deployment_id || "0";
        const mapping = depIndMap.get(depMovebankId);
        const individualId = mapping ? parseInt(mapping.individualId, 10) : null;
        return {
          studyId: study.id,
          movebankId: parseInt(depMovebankId, 10),
          individualId: individualId && !isNaN(individualId) ? individualId : null,
          localIdentifier: r.local_identifier || r.tag_local_identifier || mapping?.individualLocalIdentifier || null,
          deployOn: r.deploy_on_timestamp || r.deploy_on_date || null,
          deployOff: r.deploy_off_timestamp || r.deploy_off_date || null,
          synced: true,
        };
      });

      await Promise.all([
        storage.upsertIndividuals(study.id, individualsData.map((i) => ({ ...i, isActive: true }))),
        storage.upsertDeployments(study.id, deploymentsData),
      ]);

      await storage.updateStudy(study.id, { lastMovebankSync: new Date() } as any);

      log(`Sync completado para ${study.name}: ${individualsData.length} individuos, ${deploymentsData.length} despliegues guardados en BD`, "movebank");

      return res.json({
        individuals: individualsData.length,
        deployments: deploymentsData.length,
      });
    } catch (e: any) {
      log(`Sync error para estudio ${req.params.id}: ${e.message}`, "movebank");
      log(`Stack: ${e.stack}`, "movebank");
      if (e instanceof MovebankError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
      return res.status(500).json({ message: `Error al sincronizar: ${e.message}` });
    }
  });

  app.post("/api/studies/:id/backfill", checkRole("superuser"), requireStudyAccess, async (req, res) => {
    const MANUAL_MAX_BACKFILL_DAYS = 90;
    const MIN_GAP_MS = 60 * 1000;
    const BACKFILL_MAX_ANIMALS_PER_CALL = 50;
    const BACKFILL_REQUEST_TIMEOUT_MS = 25 * 60 * 1000;
    req.setTimeout(BACKFILL_REQUEST_TIMEOUT_MS);
    res.setTimeout(BACKFILL_REQUEST_TIMEOUT_MS);
    const studyId = String(req.params.id);
    const maxAnimals = Math.min(
      BACKFILL_MAX_ANIMALS_PER_CALL,
      Math.max(1, Number(req.body?.maxAnimals) || BACKFILL_MAX_ANIMALS_PER_CALL),
    );
    // El backfill prioriza siempre los animales con menor cobertura GPS y menos
    // recientemente intentados. La selección interna ignora startIndex (siempre
    // arranca desde el principio del orden recalculado), pero echamos un cursor
    // monotónicamente creciente al cliente para que su guard de progreso no se
    // dispare y la cadena de lotes pueda continuar.
    const inputStartIndex = Math.max(0, Number(req.body?.startIndex) || 0);

    try {
      const study = await storage.getStudyDecrypted(studyId);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
      if (!hasMovebankCredentials(study)) {
        return res.status(400).json({ message: "Este estudio no tiene credenciales de Movebank configuradas" });
      }
      const block = movebankRateLimiter.isBlocked();
      if (block.blocked) {
        return res.status(429).json({ message: block.reason, blockedUntil: block.blockedUntil?.toISOString() });
      }

      const individuals = await storage.getIndividuals(studyId);
      const validTargets = individuals.filter(i => i.localIdentifier && i.localIdentifier.trim() !== "");
      const meta = await storage.getBackfillCandidateMetadata(studyId);
      const allTargets = [...validTargets].sort((a, b) => {
        const ma = meta.get(a.localIdentifier!) ?? { gpsCount: 0, lastGpsFetchedTo: null };
        const mb = meta.get(b.localIdentifier!) ?? { gpsCount: 0, lastGpsFetchedTo: null };
        if (ma.gpsCount !== mb.gpsCount) return ma.gpsCount - mb.gpsCount;
        const ta = ma.lastGpsFetchedTo ?? -1;
        const tb = mb.lastGpsFetchedTo ?? -1;
        if (ta !== tb) return ta - tb;
        return a.localIdentifier!.localeCompare(b.localIdentifier!);
      });
      const totalAll = allTargets.length;
      const targets = allTargets.slice(0, maxAnimals);
      const total = targets.length;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      let aborted = false;
      const isClosed = () => aborted || res.writableEnded || res.destroyed || !res.writable;
      const send = (event: string, data: Record<string, unknown>) => {
        if (isClosed()) return;
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          aborted = true;
        }
      };
      res.on("close", () => { aborted = true; });
      res.on("error", () => { aborted = true; });

      send("start", { total, totalAll, startIndex: inputStartIndex, batchSize: total, hasMore: totalAll > total, nextStartIndex: totalAll > total ? inputStartIndex + total : null, maxBackfillDays: MANUAL_MAX_BACKFILL_DAYS });

      let processed = 0;
      let totalGps = 0;
      let totalAcc = 0;
      let stoppedByRateLimit = false;
      let gpsAttempts = 0;
      let gpsZeroAnimals = 0;

      const startedAt = Date.now();

      for (const animal of targets) {
        if (isClosed()) { aborted = true; break; }
        const localId = animal.localIdentifier!;
        const blk = movebankRateLimiter.isBlocked();
        if (blk.blocked) {
          stoppedByRateLimit = true;
          send("rate-limit", { reason: blk.reason, blockedUntil: blk.blockedUntil?.toISOString() });
          break;
        }

        const now = Date.now();
        const cap = now - MANUAL_MAX_BACKFILL_DAYS * 24 * 60 * 60 * 1000;

        const gpsRange = await storage.getCachedTimestampRange(studyId, localId, "gps");
        const accRange = await storage.getCachedTimestampRange(studyId, localId, "acc");
        const gpsFrom = gpsRange && Number.isFinite(gpsRange.max) ? Math.max(gpsRange.max + 1, cap) : cap;
        const accFrom = accRange && Number.isFinite(accRange.max) ? Math.max(accRange.max + 1, cap) : cap;
        const wantGps = gpsFrom < now - MIN_GAP_MS;
        const wantAcc = accFrom < now - MIN_GAP_MS;

        let animalGps = 0;
        let animalAcc = 0;
        try {
          if (wantGps) {
            const rows = await fetchMovebankEvents(study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!, localId, 653, gpsFrom, now);
            await movebankDelay();
            const toCache = rows
              .filter(r => r.location_lat && r.location_long)
              .map(r => ({
                studyId, individualLocalIdentifier: localId,
                timestamp: new Date(r.timestamp).getTime(),
                latitude: parseFloat(r.location_lat), longitude: parseFloat(r.location_long),
                groundSpeed: r.ground_speed ? parseFloat(r.ground_speed) : null,
                heading: r.heading ? parseFloat(r.heading) : null,
                heightAboveEllipsoid: r.height_above_ellipsoid ? parseFloat(r.height_above_ellipsoid) : null,
                hdop: null,
              }))
              .filter(p => !isNaN(p.timestamp) && !isNaN(p.latitude) && !isNaN(p.longitude));
            if (toCache.length > 0) await storage.insertCachedGpsEvents(toCache);
            await storage.recordFetchedRange(studyId, localId, "gps", gpsFrom, now);
            animalGps = toCache.length;
            totalGps += animalGps;
            gpsAttempts++;
            if (animalGps === 0) gpsZeroAnimals++;
          }

          const blk2 = movebankRateLimiter.isBlocked();
          if (blk2.blocked) {
            stoppedByRateLimit = true;
            send("rate-limit", { reason: blk2.reason, blockedUntil: blk2.blockedUntil?.toISOString() });
            processed++;
            send("animal", { localId, gps: animalGps, acc: 0, processed, total, totalGps, totalAcc });
            break;
          }

          if (wantAcc) {
            const rows = await fetchMovebankEvents(study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!, localId, 2365683, accFrom, now);
            await movebankDelay();
            const toCache: { studyId: string; individualLocalIdentifier: string; timestamp: number; xAcceleration: number; yAcceleration: number; zAcceleration: number; rawData: string | null }[] = [];
            for (const r of rows) {
              const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
              const ts = new Date(r.timestamp).getTime();
              if (isNaN(ts)) continue;
              if (rawAxes) {
                const vals = rawAxes.split(/\s+/).map(Number);
                for (let i = 0; i + 2 < vals.length; i += 3) {
                  if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
                    toCache.push({ studyId, individualLocalIdentifier: localId, timestamp: ts + i * 10, xAcceleration: vals[i], yAcceleration: vals[i + 1], zAcceleration: vals[i + 2], rawData: i === 0 ? rawAxes : null });
                  }
                }
              } else {
                toCache.push({ studyId, individualLocalIdentifier: localId, timestamp: ts, xAcceleration: parseFloat(r.acceleration_x || "0"), yAcceleration: parseFloat(r.acceleration_y || "0"), zAcceleration: parseFloat(r.acceleration_z || "0"), rawData: null });
              }
            }
            if (toCache.length > 0) await storage.insertCachedAccEvents(toCache);
            await storage.recordFetchedRange(studyId, localId, "acc", accFrom, now);
            animalAcc = toCache.length;
            totalAcc += animalAcc;
          }
        } catch (e: any) {
          const isRateLimit = (e instanceof MovebankError && e.statusCode === 429) || (e?.statusCode === 429);
          if (isRateLimit) {
            stoppedByRateLimit = true;
            send("rate-limit", { reason: e.message });
            processed++;
            send("animal", { localId, gps: animalGps, acc: animalAcc, processed, total, totalGps, totalAcc, error: e.message });
            break;
          }
          send("animal-error", { localId, error: e.message });
        }

        processed++;
        send("animal", { localId, gps: animalGps, acc: animalAcc, processed, total, totalGps, totalAcc });
      }

      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      const status = stoppedByRateLimit ? "partial" : (aborted ? "aborted" : "success");
      const details = `manual: ${processed}/${total} animales, ${totalGps} GPS, ${totalAcc} ACC, cortado: ${stoppedByRateLimit}, abortado: ${aborted}, dur: ${duration}s`;
      try {
        await storage.createCronLog("movebank_sync", status, details);
      } catch {}

      if (gpsAttempts >= 5) {
        const zeroPct = (gpsZeroAnimals / gpsAttempts) * 100;
        if (zeroPct > 80) {
          log(`Backfill: WARN: Posible problema con parámetros Movebank: ${zeroPct.toFixed(1)}% de animales (${gpsZeroAnimals}/${gpsAttempts}) devolvieron 0 GPS`, "movebank");
          try {
            await storage.createCronLog("movebank_sync_anomaly", "warn", `manual ${study.name}: ${zeroPct.toFixed(1)}% animales con 0 GPS (${gpsZeroAnimals}/${gpsAttempts})`);
          } catch {}
        }
      }

      if (totalGps > 0 || totalAcc > 0) {
        try {
          const { triggerImmobilityAnalysisInBackground } = await import("./immobilityDetector");
          triggerImmobilityAnalysisInBackground(studyId, "manual-backfill");
          log(`Backfill: análisis de alertas disparado en background para estudio ${studyId}`, "movebank");
        } catch (e: any) {
          log(`Backfill: error disparando análisis en background: ${e?.message ?? e}`, "movebank");
        }
      }

      if (!isClosed()) {
        // Detenemos el bucle si: hubo rate-limit, abort, no quedan más candidatos,
        // o el lote completo no produjo datos (animales atascados sin transmisión).
        const madeProgress = totalGps > 0 || totalAcc > 0;
        const moreCandidates = totalAll > total;
        const hasMore = moreCandidates && madeProgress && !stoppedByRateLimit && !aborted;
        const nextStartIndex = hasMore ? inputStartIndex + total : null;
        send("done", {
          processed, total, totalAll,
          startIndex: inputStartIndex, batchSize: total,
          hasMore,
          nextStartIndex,
          totalGps, totalAcc,
          stoppedByRateLimit, aborted,
          durationSec: duration, status,
        });
        try { res.end(); } catch {}
      }
    } catch (e: any) {
      log(`Backfill error: ${e.message}`, "movebank");
      if (!res.headersSent) {
        return res.status(500).json({ message: `Error en backfill: ${e.message}` });
      }
      try {
        if (res.writable && !res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
          res.end();
        }
      } catch {}
    }
  });

  app.post("/api/studies/:id/repair-deployments-local", requireSuperuser, requireStudyAccess, async (req, res) => {
    try {
      log(`Repair-deployments-local iniciado para estudio: ${req.params.id}`, "movebank");
      const result = await storage.repairDeploymentsLocal(req.params.id as string);
      log(`Repair-local completado: total=${result.total}, linked=${result.linked}, repaired=${result.repaired}, unlinked=${result.unlinked}`, "movebank");
      return res.json(result);
    } catch (e: any) {
      log(`Repair-local error: ${e.message}`, "movebank");
      return res.status(500).json({ message: `Error al reparar localmente: ${e.message}` });
    }
  });

  app.post("/api/studies/:id/repair-deployments", movebankLimiter, requireSuperuser, requireStudyAccess, async (req, res) => {
    try {
      const blockCheck = movebankRateLimiter.isBlocked();
      if (blockCheck.blocked) {
        return res.status(429).json({ message: blockCheck.reason, blockedUntil: blockCheck.blockedUntil?.toISOString() });
      }

      log(`Repair-deployments iniciado para estudio: ${req.params.id}`, "movebank");
      const study = await storage.getStudyDecrypted(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      if (!hasMovebankCredentials(study)) {
        return res.status(400).json({ message: "Este estudio no tiene credenciales de Movebank configuradas" });
      }

      const rawDeployments = await fetchMovebankDeployments(study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!);
      await movebankDelay();
      const depIndMap = await fetchMovebankDeploymentIndividualMap(study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!);

      log(`Repair: ${rawDeployments.length} deployments from Movebank, ${depIndMap.size} deployment→individual mappings from events`, "movebank");

      if (rawDeployments.length > 0) {
        const allColumns = Object.keys(rawDeployments[0]);
        log(`Repair: Deployment CSV columns: ${allColumns.join(", ")}`, "movebank");
      }

      for (const [depId, info] of Array.from(depIndMap.entries()).slice(0, 5)) {
        log(`Repair: mapping deployment ${depId} → individual ${info.individualId} (${info.individualLocalIdentifier})`, "movebank");
      }

      const deploymentsData = rawDeployments.map((r) => {
        const depMovebankId = r.id || r.deployment_id || "0";
        const mapping = depIndMap.get(depMovebankId);
        const individualId = mapping ? parseInt(mapping.individualId, 10) : null;
        const localId = r.local_identifier || r.tag_local_identifier || mapping?.individualLocalIdentifier || null;

        return {
          studyId: study.id,
          movebankId: parseInt(depMovebankId, 10),
          individualId: individualId && !isNaN(individualId) ? individualId : null,
          localIdentifier: localId,
          deployOn: r.deploy_on_timestamp || r.deploy_on_date || null,
          deployOff: r.deploy_off_timestamp || r.deploy_off_date || null,
          synced: true,
        };
      });

      const linked = deploymentsData.filter(d => d.individualId != null).length;
      const unlinked = deploymentsData.filter(d => d.individualId == null).length;

      await storage.upsertDeployments(study.id, deploymentsData);

      log(`Repair completado para ${study.name}: ${linked} vinculados, ${unlinked} sin vincular de ${deploymentsData.length} total`, "movebank");

      return res.json({
        total: deploymentsData.length,
        linked,
        unlinked,
      });
    } catch (e: any) {
      log(`Repair error para estudio ${req.params.id}: ${e.message}`, "movebank");
      if (e instanceof MovebankError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
      return res.status(500).json({ message: `Error al reparar deployments: ${e.message}` });
    }
  });

  // Configuración global de umbral "sin transmisión"
  app.get("/api/admin/settings/no-transmission-threshold-days", checkRole("superuser", "user", "observer"), async (_req, res) => {
    try {
      const { getNoTransmissionThresholdDays, NO_TRANSMISSION_THRESHOLD_DAYS_OPTIONS, DEFAULT_NO_TRANSMISSION_THRESHOLD_DAYS } = await import("./immobilityDetector");
      const days = await getNoTransmissionThresholdDays();
      return res.json({ days, options: NO_TRANSMISSION_THRESHOLD_DAYS_OPTIONS, default: DEFAULT_NO_TRANSMISSION_THRESHOLD_DAYS });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/settings/movebank-auto-sync", checkRole("superuser", "user", "observer"), async (_req, res) => {
    try {
      const { getMovebankAutoSyncEnabled, DEFAULT_MOVEBANK_AUTO_SYNC_ENABLED } = await import("./scheduler");
      const enabled = await getMovebankAutoSyncEnabled();
      return res.json({ enabled, default: DEFAULT_MOVEBANK_AUTO_SYNC_ENABLED });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/admin/settings/movebank-auto-sync", checkRole("superuser"), async (req, res) => {
    try {
      const { MOVEBANK_AUTO_SYNC_KEY } = await import("./scheduler");
      const { z } = await import("zod");
      const schema = z.object({ enabled: z.boolean() });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.flatten() });
      }
      await storage.setSetting(MOVEBANK_AUTO_SYNC_KEY, parsed.data.enabled ? "true" : "false");
      return res.json({ enabled: parsed.data.enabled });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/admin/settings/no-transmission-threshold-days", checkRole("superuser"), async (req, res) => {
    try {
      const { NO_TRANSMISSION_THRESHOLD_DAYS_KEY, NO_TRANSMISSION_THRESHOLD_DAYS_OPTIONS } = await import("./immobilityDetector");
      const { z } = await import("zod");
      const schema = z.object({
        days: z.coerce.number().int().refine(
          (n) => (NO_TRANSMISSION_THRESHOLD_DAYS_OPTIONS as readonly number[]).includes(n),
          { message: `days debe ser uno de: ${NO_TRANSMISSION_THRESHOLD_DAYS_OPTIONS.join(", ")}` },
        ),
      });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.flatten() });
      }
      await storage.setSetting(NO_TRANSMISSION_THRESHOLD_DAYS_KEY, String(parsed.data.days));
      return res.json({ days: parsed.data.days });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // Immobility / Mortality Analysis
  app.post("/api/studies/:id/immobility-analysis", checkRole("superuser", "user"), requireStudyAccess, async (req, res) => {
    try {
      const { analyzeImmobility } = await import("./immobilityDetector");
      const { z } = await import("zod");
      const configSchema = z.object({
        hoursToAnalyze: z.coerce.number().min(1).max(2160).optional(),
        immobilityThresholdHours: z.coerce.number().min(1).max(720).optional(),
        noTransmissionThresholdHours: z.coerce.number().min(1).max(720).optional(),
        speedThreshold: z.coerce.number().min(0).max(100).optional(),
        positionChangeThreshold: z.coerce.number().min(0).max(1).optional(),
        accVarianceThreshold: z.coerce.number().min(0).max(10000).optional(),
        accMinSamples: z.coerce.number().min(2).max(100000).optional(),
        immobilityRadiusMeters: z.coerce.number().min(1).max(100000).optional(),
        enableImmobility: z.boolean().optional(),
        enableNoTransmission: z.boolean().optional(),
        enableAccConsecutive: z.boolean().optional(),
        enableZNegative: z.boolean().optional(),
      }).passthrough();
      const parsed = configSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.flatten() });
      }
      const result = await analyzeImmobility(req.params.id as string, parsed.data);
      return res.json(result);
    } catch (e: any) {
      log(`Immobility analysis error: ${e.message}`, "analysis");
      return res.status(500).json({ message: `Error en análisis de inmovilidad: ${e.message}` });
    }
  });

  app.get("/api/studies/:id/immobility-status", requireStudyAccess, async (req, res) => {
    try {
      const tsEnd = Date.now();
      const tsStart = tsEnd - 30 * 24 * 60 * 60 * 1000;
      const { events } = await storage.getAllDetectedEvents({
        studyId: req.params.id as string,
        eventType: "mortality",
        timestampStart: tsStart,
        timestampEnd: tsEnd,
        limit: 100,
        offset: 0,
      });
      const sorted = events.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
      return res.json({ events: sorted, lastCheck: sorted.length > 0 ? sorted[0].createdAt : null });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // Ornitela Sync
  const ornitelaSyncTimestamps = new Map<string, number>();

  app.get("/api/studies/:id/ornitela-devices", requireSuperuser, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
      if (!study.ornitelaUsername || !study.ornitelaPassword) {
        return res.status(400).json({ message: "Credenciales de Ornitela no configuradas para este estudio" });
      }
      const panelUrl = study.ornitelaPanelUrl || "https://cpanel.glosendas.net";
      const session = await ornitelaSync.login(panelUrl, study.ornitelaUsername, study.ornitelaPassword);
      const devices = await ornitelaSync.getDeviceList(panelUrl, session);
      return res.json({ devices, panelUrl });
    } catch (e: any) {
      const statusCode = e.statusCode || 500;
      return res.status(statusCode).json({ message: e.message });
    }
  });

  app.get("/api/studies/:id/ornitela-status", requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudy(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
      return res.json({
        ornitelaEnabled: study.ornitelaEnabled,
        ornitelaLastSync: study.ornitelaLastSync,
        ornitelaSyncIntervalHours: study.ornitelaSyncIntervalHours,
        ornitelaPanelUrl: study.ornitelaPanelUrl,
        hasCredentials: !!(study.ornitelaUsername && study.ornitelaPassword),
      });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/studies/:id/ornitela-config", requireSuperuser, async (req, res) => {
    try {
      const { enabled, username, password, syncIntervalHours, panelUrl } = req.body;
      const updateData: Record<string, any> = {};
      if (enabled !== undefined) updateData.ornitelaEnabled = !!enabled;
      if (username && username !== "••••••••") updateData.ornitelaUsername = username;
      if (password && password !== "••••••••") updateData.ornitelaPassword = password;
      if (syncIntervalHours !== undefined) {
        const interval = Math.max(1, Math.min(24, Math.floor(Number(syncIntervalHours) || 6)));
        updateData.ornitelaSyncIntervalHours = interval;
      }
      if (panelUrl) {
        try {
          const parsed = new URL(panelUrl);
          if (parsed.protocol !== "https:") {
            return res.status(400).json({ message: "La URL del panel debe usar HTTPS" });
          }
          updateData.ornitelaPanelUrl = panelUrl;
        } catch {
          return res.status(400).json({ message: "URL del panel inválida" });
        }
      }
      const study = await storage.updateStudy(req.params.id, updateData);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
      return res.json(maskStudyCredentials(study));
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  const ORNITELA_DEVICE_DELAY_MS = 1500;
  const ORNITELA_MAX_DEVICES_PER_CALL = 50;

  app.post("/api/studies/:id/ornitela-sync", requireSuperuser, async (req, res) => {
    const studyId = req.params.id;
    const requestedStartIndex = Math.max(0, Number(req.body?.startIndex) || 0);
    const isContinuationBatch = requestedStartIndex > 0;
    if (!isContinuationBatch) {
      const lastSync = ornitelaSyncTimestamps.get(studyId) || 0;
      const thirtyMinMs = 30 * 60 * 1000;
      if (Date.now() - lastSync < thirtyMinMs) {
        const minutesLeft = Math.ceil((thirtyMinMs - (Date.now() - lastSync)) / 60000);
        return res.status(429).json({ message: `Sincronización limitada. Espera ${minutesLeft} minutos.` });
      }
    }

    let study;
    try {
      study = await storage.getStudyDecrypted(studyId);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
    if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
    if (!study.ornitelaUsername || !study.ornitelaPassword) {
      return res.status(400).json({ message: "Credenciales de Ornitela no configuradas" });
    }

    const panelUrl = study.ornitelaPanelUrl || "https://cpanel.glosendas.net";
    const hoursBack = Number(req.body?.hoursBack) || 168;
    const startIndex = requestedStartIndex;
    const maxDevices = Math.min(
      ORNITELA_MAX_DEVICES_PER_CALL,
      Math.max(1, Number(req.body?.maxDevices) || ORNITELA_MAX_DEVICES_PER_CALL),
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let aborted = false;
    const isClosed = () => aborted || res.writableEnded || res.destroyed || !res.writable;
    const send = (event: string, data: Record<string, unknown>) => {
      if (isClosed()) return;
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        aborted = true;
      }
    };
    res.on("close", () => { aborted = true; });
    res.on("error", () => { aborted = true; });

    const startedAt = Date.now();

    try {
      send("login", { panelUrl });
      const session = await ornitelaSync.login(panelUrl, study.ornitelaUsername, study.ornitelaPassword);
      const allDevices = await ornitelaSync.getDeviceList(panelUrl, session);

      if (allDevices.length === 0) {
        await storage.updateStudy(studyId, { ornitelaLastSync: new Date() } as any);
        send("done", { totalDevices: 0, processed: 0, totalGps: 0, totalAcc: 0, hasMore: false, message: "No se encontraron dispositivos" });
        try { res.end(); } catch {}
        return;
      }

      const slice = allDevices.slice(startIndex, startIndex + maxDevices);
      const hasMore = startIndex + slice.length < allDevices.length;
      const nextStartIndex = hasMore ? startIndex + slice.length : null;

      send("start", {
        totalDevices: allDevices.length,
        startIndex,
        batchSize: slice.length,
        hasMore,
        nextStartIndex,
        hoursBack,
      });

      const now = new Date();
      const fromDate = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
      const fmtDt = (d: Date) => {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        const h = String(d.getUTCHours()).padStart(2, "0");
        const min = String(d.getUTCMinutes()).padStart(2, "0");
        return `${y}-${m}-${day} ${h}:${min}`;
      };
      const fromStr = fmtDt(fromDate);
      const toStr = fmtDt(now);

      let processed = 0;
      let totalGps = 0;
      let totalAcc = 0;
      let totalGpsDup = 0;
      let totalAccDup = 0;
      let totalErrors = 0;
      const deviceResults: any[] = [];

      for (let i = 0; i < slice.length; i++) {
        if (isClosed()) { aborted = true; break; }
        const device = slice[i];

        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, ORNITELA_DEVICE_DELAY_MS));
        }
        if (isClosed()) { aborted = true; break; }

        let deviceGps = 0;
        let deviceAcc = 0;
        let deviceGpsDup = 0;
        let deviceAccDup = 0;
        let deviceSubformat: string | undefined;
        let deviceError: string | undefined;

        try {
          const csv = await ornitelaSync.downloadCSV(panelUrl, session, device.imei, fromStr, toStr);
          if (!csv || csv.trim().length < 10) {
            deviceError = "CSV vacío";
          } else {
            const importResult = await parseOrnitelaCsv(csv, studyId, storage, { ornitelaName: device.name });
            deviceGps = importResult.gpsImported;
            deviceAcc = importResult.accImported;
            deviceGpsDup = importResult.gpsDuplicates;
            deviceAccDup = importResult.accDuplicates;
            deviceSubformat = importResult.ornitela_subformat;
            totalErrors += importResult.errors;
            totalGps += deviceGps;
            totalAcc += deviceAcc;
            totalGpsDup += deviceGpsDup;
            totalAccDup += deviceAccDup;
          }
        } catch (err: any) {
          deviceError = err.message || String(err);
          log(`Ornitela error en dispositivo ${device.name} (${device.imei}): ${deviceError}`, "ornitela");
        }

        const entry = {
          imei: device.imei,
          name: device.name,
          gps: deviceGps,
          acc: deviceAcc,
          gpsDup: deviceGpsDup,
          accDup: deviceAccDup,
          subformat: deviceSubformat,
          error: deviceError,
        };
        deviceResults.push(entry);
        processed++;
        send("device", {
          ...entry,
          processed,
          batchSize: slice.length,
          totalDevices: allDevices.length,
          totalGps,
          totalAcc,
        });
      }

      await storage.updateStudy(studyId, { ornitelaLastSync: new Date() } as any);
      // Solo aplicar el cooldown de 30 min cuando finaliza la sincronización completa,
      // no entre batches (que son llamadas continuadas del mismo flujo).
      if (!hasMore) {
        ornitelaSyncTimestamps.set(studyId, Date.now());
      }

      const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      log(`Ornitela sync (lote ${startIndex}-${startIndex + processed}/${allDevices.length}): ${totalGps} GPS, ${totalAcc} ACC (${durationSec}s)${hasMore ? " — continúa" : " — fin"}`, "ornitela");

      if (!isClosed()) {
        send("done", {
          totalDevices: allDevices.length,
          processed,
          totalGps,
          totalAcc,
          totalGpsDup,
          totalAccDup,
          totalErrors,
          deviceResults,
          hasMore,
          nextStartIndex,
          durationSec,
          syncedAt: new Date().toISOString(),
        });
        try { res.end(); } catch {}
      }
    } catch (e: any) {
      log(`Ornitela sync error: ${e.message}`, "ornitela");
      if (!res.headersSent) {
        return res.status(e.statusCode || 500).json({ message: e.message });
      }
      if (!isClosed()) {
        send("error", { message: e.message });
        try { res.end(); } catch {}
      }
    }
  });

  // Geospatial Analysis
  app.post("/api/studies/:id/analysis", checkRole("superuser", "user"), requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const { analysisType, individuals: animalIds, timestampStart, timestampEnd, params } = req.body;

      if (!ANALYSIS_TYPES.includes(analysisType)) {
        return res.status(400).json({ message: `Tipo de analisis invalido. Use: ${ANALYSIS_TYPES.join(", ")}` });
      }
      if (!animalIds || !Array.isArray(animalIds) || animalIds.length === 0) {
        return res.status(400).json({ message: "Seleccione al menos un animal" });
      }
      if (!timestampStart || !timestampEnd) {
        return res.status(400).json({ message: "Rango de fechas requerido" });
      }

      const allGpsRows: { individual_id: string; timestamp: number; latitude: number; longitude: number }[] = [];

      for (const animalId of animalIds) {
        const cachedEvents = await clippedGpsFor(
          study.id,
          animalId,
          timestampStart,
          timestampEnd
        );

        if (cachedEvents.length > 0) {
          for (const ev of cachedEvents) {
            if (ev.latitude != null && ev.longitude != null) {
              allGpsRows.push({
                individual_id: animalId,
                timestamp: ev.timestamp,
                latitude: ev.latitude,
                longitude: ev.longitude,
              });
            }
          }
          log(`Analysis: used ${cachedEvents.length} cached GPS events for ${animalId}`, "analysis");
        } else {
          try {
            const gpsEvents = await fetchMovebankEvents(
              study.movebankStudyId!,
              study.movebankUsername!,
              study.movebankPassword!,
              animalId,
              653,
              timestampStart,
              timestampEnd
            );
            await movebankDelay();

            const newCachedEvents: Omit<CachedGpsEvent, "id">[] = [];
            for (const ev of gpsEvents) {
              if (ev.location_lat && ev.location_long) {
                const lat = parseFloat(ev.location_lat);
                const lng = parseFloat(ev.location_long);
                const ts = new Date(ev.timestamp).getTime();
                if (!isNaN(lat) && !isNaN(lng) && !isNaN(ts)) {
                  allGpsRows.push({ individual_id: animalId, timestamp: ts, latitude: lat, longitude: lng });
                  newCachedEvents.push({
                    studyId: study.id,
                    individualLocalIdentifier: animalId,
                    timestamp: ts,
                    latitude: lat,
                    longitude: lng,
                    groundSpeed: ev.ground_speed ? parseFloat(ev.ground_speed) : null,
                    heading: ev.heading ? parseFloat(ev.heading) : null,
                    heightAboveEllipsoid: ev.height_above_ellipsoid ? parseFloat(ev.height_above_ellipsoid) : null,
                    hdop: null,
                  });
                }
              }
            }

            if (newCachedEvents.length > 0) {
              await storage.insertCachedGpsEvents(newCachedEvents);
              log(`Analysis: fetched and cached ${newCachedEvents.length} GPS events from Movebank for ${animalId}`, "analysis");
            }
          } catch (mbErr: any) {
            log(`Analysis: Movebank fetch failed for ${animalId}: ${mbErr.message}, continuing with cached data only`, "analysis");
          }
        }
      }

      if (allGpsRows.length < 2) {
        return res.status(400).json({ message: "No se encontraron datos GPS suficientes en el rango seleccionado" });
      }

      // Submuestreo uniforme opcional: si un animal supera maxPoints, se toma
      // 1 de cada N puntos espaciados uniformemente en el tiempo (por animal).
      let gpsRowsForAnalysis = allGpsRows;
      const maxPointsRaw = params?.maxPoints;
      if (typeof maxPointsRaw === "number" && Number.isFinite(maxPointsRaw)) {
        const maxPoints = Math.max(100, Math.min(5000, Math.round(maxPointsRaw)));
        const uniformSubsample = <T>(arr: T[], max: number): T[] => {
          if (arr.length <= max) return arr;
          const out: T[] = [];
          // Incluye primer y último punto del rango; max>=100 garantiza max>1.
          for (let i = 0; i < max; i++) {
            out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))]);
          }
          return out;
        };
        const byAnimal = new Map<string, typeof allGpsRows>();
        for (const row of allGpsRows) {
          let list = byAnimal.get(row.individual_id);
          if (!list) { list = []; byAnimal.set(row.individual_id, list); }
          list.push(row);
        }
        const reduced: typeof allGpsRows = [];
        for (const list of Array.from(byAnimal.values())) {
          list.sort((a, b) => a.timestamp - b.timestamp);
          reduced.push(...uniformSubsample(list, maxPoints));
        }
        if (reduced.length !== allGpsRows.length) {
          log(`Analysis: subsampled GPS points ${allGpsRows.length} -> ${reduced.length} (maxPoints=${maxPoints})`, "analysis");
        }
        gpsRowsForAnalysis = reduced;
      }

      const ANALYSIS_TIMEOUT_MS = 60000;
      const analysisPromise = new Promise<AnalysisResult>((resolve, reject) => {
        try {
          const result = runAnalysis(analysisType, gpsRowsForAnalysis, params);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("ANALYSIS_TIMEOUT")), ANALYSIS_TIMEOUT_MS);
      });

      let resultData: AnalysisResult;
      try {
        resultData = await Promise.race([analysisPromise, timeoutPromise]);
      } catch (timeoutErr: any) {
        if (timeoutErr.message === "ANALYSIS_TIMEOUT") {
          log(`Analysis timeout after ${ANALYSIS_TIMEOUT_MS / 1000}s for study ${study.id}`, "analysis");
          return res.status(408).json({
            message: "El cálculo tardó demasiado (más de 60 segundos). Intente con un rango de fechas menor o menos animales.",
          });
        }
        throw timeoutErr;
      }

      const saved = await storage.createSavedAnalysis({
        userId: req.user!.id,
        studyId: study.id,
        analysisType: analysisType as AnalysisType,
        individuals: animalIds,
        timestampStart,
        timestampEnd,
        params: params || {},
        resultData: resultData as any,
        resultGeojson: (resultData as any).geojson || null,
      });

      return res.json({
        id: saved.id,
        ...resultData,
      });
    } catch (e: any) {
      log(`Analysis error: ${e.message}`, "analysis");
      return res.status(500).json({ message: `Error en analisis: ${e.message}` });
    }
  });

  app.post("/api/studies/:id/export-valores", checkRole("superuser", "user"), requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id as string);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const { individuals: animalIds, timestampStart, timestampEnd } = req.body;

      if (!animalIds || !Array.isArray(animalIds) || animalIds.length === 0) {
        return res.status(400).json({ message: "Seleccione al menos un animal" });
      }
      if (!timestampStart || !timestampEnd) {
        return res.status(400).json({ message: "Rango de fechas requerido" });
      }

      const allGpsRows: { individual_id: string; timestamp: number; latitude: number; longitude: number }[] = [];

      for (const animalId of animalIds) {
        const cachedEvents = await clippedGpsFor(study.id, animalId, timestampStart, timestampEnd);

        if (cachedEvents.length > 0) {
          for (const ev of cachedEvents) {
            if (ev.latitude != null && ev.longitude != null) {
              allGpsRows.push({ individual_id: animalId, timestamp: ev.timestamp, latitude: ev.latitude, longitude: ev.longitude });
            }
          }
        } else {
          try {
            const gpsEvents = await fetchMovebankEvents(
              study.movebankStudyId!, study.movebankUsername!, study.movebankPassword!,
              animalId, 653, timestampStart, timestampEnd
            );
            await movebankDelay();
            for (const ev of gpsEvents) {
              if (ev.location_lat && ev.location_long) {
                const lat = parseFloat(ev.location_lat);
                const lng = parseFloat(ev.location_long);
                const ts = new Date(ev.timestamp).getTime();
                if (!isNaN(lat) && !isNaN(lng) && !isNaN(ts)) {
                  allGpsRows.push({ individual_id: animalId, timestamp: ts, latitude: lat, longitude: lng });
                }
              }
            }
          } catch (mbErr: any) {
            log(`VALORES export: Movebank fetch failed for ${animalId}: ${mbErr.message}`, "analysis");
          }
        }
      }

      if (allGpsRows.length < 2) {
        return res.status(400).json({ message: "No se encontraron datos GPS suficientes" });
      }

      const ANALYSIS_TIMEOUT_MS = 120000;
      const analysisPromise = new Promise<AnalysisResult>((resolve, reject) => {
        try {
          resolve(runAnalysis("comprehensive", allGpsRows, { bandwidthMethod: "both" }));
        } catch (err) { reject(err); }
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("ANALYSIS_TIMEOUT")), ANALYSIS_TIMEOUT_MS);
      });

      let resultData: AnalysisResult;
      try {
        resultData = await Promise.race([analysisPromise, timeoutPromise]);
      } catch (timeoutErr: any) {
        if (timeoutErr.message === "ANALYSIS_TIMEOUT") {
          return res.status(408).json({ message: "El cálculo tardó demasiado. Intente con menos animales o un rango menor." });
        }
        throw timeoutErr;
      }

      const csv = buildValoresCsv(resultData as any);
      const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="VALORES_${dateStr}.csv"`);
      return res.send("\uFEFF" + csv);
    } catch (e: any) {
      log(`VALORES export error: ${e.message}`, "analysis");
      return res.status(500).json({ message: `Error exportando VALORES: ${e.message}` });
    }
  });

  app.get("/api/studies/:id/analyses", requireStudyAccess, async (req, res) => {
    const analyses = await storage.getSavedAnalyses(req.params.id as string, req.user!.id);
    return res.json(analyses);
  });

  app.get("/api/analyses/:id", requireAuth, async (req, res) => {
    const analysis = await storage.getSavedAnalysis(req.params.id);
    if (!analysis) return res.status(404).json({ message: "Analisis no encontrado" });
    const user = req.user!;
    if (user.role !== "superuser" && analysis.userId !== user.id) {
      return res.status(403).json({ message: "Acceso denegado" });
    }
    return res.json(analysis);
  });

  app.get("/api/analyses/:id/export-csv", checkRole("superuser", "user"), async (req, res) => {
    try {
      const analysis = await storage.getSavedAnalysis(req.params.id);
      if (!analysis) return res.status(404).json({ message: "Analisis no encontrado" });
      const user = req.user!;
      if (user.role !== "superuser" && analysis.userId !== user.id) {
        return res.status(403).json({ message: "Acceso denegado" });
      }

      const resultData = analysis.resultData as any;
      let csv = "";

      if (resultData?.analysisType === "comprehensive" && resultData.perIndividual) {
        csv = buildValoresCsv(resultData);
      } else if (resultData?.analysisType === "mcp") {
        csv = "Animal,Area_km2\n";
        for (const a of resultData.areas || []) {
          csv += `${a.individual},${a.area_km2}\n`;
        }
      } else if (resultData?.analysisType === "kernel") {
        const pcts: number[] = Array.isArray(resultData.kernelPercentages) && resultData.kernelPercentages.length > 0
          ? [...resultData.kernelPercentages].sort((a: number, b: number) => a - b)
          : [50, 95];
        csv = `Animal,${pcts.map((p) => `Area_${p}_km2`).join(",")}\n`;
        for (const a of resultData.areas || []) {
          const row = [a.individual];
          for (const p of pcts) row.push(a.areas?.[String(p)] ?? "");
          csv += row.join(",") + "\n";
        }
      } else if (resultData?.analysisType === "distance") {
        csv = "Animal,Distancia_total_km,Promedio_diario_km,Distancia_neta_km,Indice_linealidad\n";
        for (const ind of resultData.individuals || []) {
          const lin = typeof ind.linearity_index === "number" ? ind.linearity_index : "";
          const net = typeof ind.net_displacement_km === "number" ? ind.net_displacement_km : "";
          csv += `${ind.individual},${ind.total_km},${ind.average_daily_km},${net},${lin}\n`;
        }
        csv += "\nAnimal,Fecha,Distancia_km\n";
        for (const ind of resultData.individuals || []) {
          for (const d of ind.daily || []) {
            csv += `${ind.individual},${d.date},${d.distance_km}\n`;
          }
        }
      } else if (resultData?.analysisType === "speed") {
        csv = "Animal,Timestamp,Velocidad_kmh\n";
        for (const ind of resultData.individuals || []) {
          for (const s of ind.speeds || []) {
            csv += `${ind.individual},${new Date(s.timestamp).toISOString()},${s.speed_kmh}\n`;
          }
        }
      }

      const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
      const fileName = `VALORES_${dateStr}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send("\uFEFF" + csv);
    } catch (e: any) {
      return res.status(500).json({ message: `Error exportando CSV: ${e.message}` });
    }
  });

  app.get("/api/analyses/:id/export-hrref", checkRole("superuser", "user"), async (req, res) => {
    try {
      const analysis = await storage.getSavedAnalysis(req.params.id);
      if (!analysis) return res.status(404).json({ message: "Analisis no encontrado" });
      const user = req.user!;
      if (user.role !== "superuser" && analysis.userId !== user.id) {
        return res.status(403).json({ message: "Acceso denegado" });
      }
      const resultData = analysis.resultData as any;
      if (resultData?.analysisType !== "comprehensive" || !resultData.perIndividual) {
        return res.status(400).json({ message: "Solo disponible para analisis completo" });
      }

      const hrrefPcts: number[] = Array.isArray(resultData.kernelPercentages) && resultData.kernelPercentages.length > 0
        ? [...resultData.kernelPercentages].sort((a: number, b: number) => a - b)
        : KERNEL_PERCENTAGES;
      let csv = "Animal,porcentaje,hr_area_m2,hr_area_km2\n";
      for (const ind of resultData.perIndividual) {
        for (const pct of hrrefPcts) {
          const km2 = ind.kernelHrefAreas?.[`${pct}`];
          if (km2 != null) {
            csv += `${ind.individual},${pct},${km2 * 1e6},${km2}\n`;
          }
        }
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="HRREF.csv"`);
      return res.send("\uFEFF" + csv);
    } catch (e: any) {
      return res.status(500).json({ message: `Error exportando HRREF: ${e.message}` });
    }
  });

  app.get("/api/analyses/:id/export-mpc", checkRole("superuser", "user"), async (req, res) => {
    try {
      const analysis = await storage.getSavedAnalysis(req.params.id);
      if (!analysis) return res.status(404).json({ message: "Analisis no encontrado" });
      const user = req.user!;
      if (user.role !== "superuser" && analysis.userId !== user.id) {
        return res.status(403).json({ message: "Acceso denegado" });
      }
      const resultData = analysis.resultData as any;
      if (resultData?.analysisType !== "comprehensive" || !resultData.perIndividual) {
        return res.status(400).json({ message: "Solo disponible para analisis completo" });
      }

      let csv = "Animal,porcentaje,area_m2,area_km2\n";
      for (const ind of resultData.perIndividual) {
        for (const pct of MCP_PERCENTAGES) {
          const km2 = ind.mcpAreas?.[`${pct}`];
          if (km2 != null) {
            csv += `${ind.individual},${pct},${km2 * 1e6},${km2}\n`;
          }
        }
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="MPC.csv"`);
      return res.send("\uFEFF" + csv);
    } catch (e: any) {
      return res.status(500).json({ message: `Error exportando MPC: ${e.message}` });
    }
  });

  app.get("/api/analyses/:id/export-geojson", checkRole("superuser", "user"), async (req, res) => {
    try {
      const analysis = await storage.getSavedAnalysis(req.params.id);
      if (!analysis) return res.status(404).json({ message: "Analisis no encontrado" });
      const user = req.user!;
      if (user.role !== "superuser" && analysis.userId !== user.id) {
        return res.status(403).json({ message: "Acceso denegado" });
      }

      const geojson = analysis.resultGeojson;
      if (!geojson) {
        return res.status(400).json({ message: "No hay datos geoespaciales para exportar" });
      }

      res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="analisis_geoespacial.geojson"`);
      return res.send(JSON.stringify(geojson, null, 2));
    } catch (e: any) {
      return res.status(500).json({ message: `Error exportando GeoJSON: ${e.message}` });
    }
  });

  app.delete("/api/analyses/:id", checkRole("superuser", "user"), async (req, res) => {
    const analysis = await storage.getSavedAnalysis(req.params.id);
    if (!analysis) return res.status(404).json({ message: "Analisis no encontrado" });
    const user = req.user!;
    if (user.role !== "superuser" && analysis.userId !== user.id) {
      return res.status(403).json({ message: "Acceso denegado" });
    }
    await storage.deleteSavedAnalysis(req.params.id);
    return res.json({ ok: true });
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

  app.post("/api/studies/:id/import-csv", checkRole("superuser", "user"), requireStudyAccess, upload.single("file"), async (req, res) => {
    try {
      const studyId = req.params.id as string;
      const study = await storage.getStudy(studyId);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const file = req.file;
      if (!file) return res.status(400).json({ message: "No se proporcionó archivo" });

      const dataType = req.body.dataType as string;
      if (dataType !== "gps" && dataType !== "acc") {
        return res.status(400).json({ message: "Tipo de datos inválido. Use 'gps' o 'acc'" });
      }

      let requestedFormat = (req.body.format as string || "auto").toLowerCase();

      const content = file.buffer.toString("utf-8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) return res.status(400).json({ message: "El archivo CSV debe tener al menos una cabecera y una fila de datos" });

      const hasSemicolon = lines[0].includes(";");
      const separator = hasSemicolon ? ";" : (lines[0].includes("\t") ? "\t" : ",");
      const rawHeaders = parseCsvLine(lines[0], separator).map((h) => h.trim().replace(/^"/, "").replace(/"$/, ""));
      const headersLower = rawHeaders.map((h) => h.toLowerCase().replace(/-/g, "_"));

      const colMap: Record<string, number> = {};
      headersLower.forEach((h, i) => { colMap[h] = i; });

      const findCol = (...names: string[]): number => {
        for (const n of names) {
          if (colMap[n] !== undefined) return colMap[n];
        }
        return -1;
      };

      const hasOrnitellaCols = findCol("device_id", "deviceid", "dev_id", "tagid", "tag_id") >= 0
        && findCol("utc_datetime", "datetime_utc", "utc_date", "utc_time", "datetime", "date_time") >= 0;
      const hasBaseLunarCols = findCol("nombre") >= 0 && findCol("fecha") >= 0 && findCol("hora") >= 0 && findCol("x") >= 0 && findCol("y") >= 0;
      const hasMovebankCols = findCol("timestamp") >= 0 && findCol("individual_local_identifier", "individual.local.identifier") >= 0;

      let detectedFormat: "movebank" | "baselunar" | "ornitella" = "movebank";
      if (hasOrnitellaCols) {
        detectedFormat = "ornitella";
      } else if (hasBaseLunarCols) {
        detectedFormat = "baselunar";
      } else if (hasSemicolon && !hasMovebankCols) {
        detectedFormat = "baselunar";
      }

      const format = requestedFormat === "auto" ? detectedFormat : (requestedFormat as "movebank" | "baselunar" | "ornitella");

      if (format === "baselunar") {
        if (dataType !== "gps") {
          return res.status(400).json({ message: "El formato Base Lunar solo soporta datos GPS" });
        }

        const nombreCol = findCol("nombre");
        const nombreComunCol = findCol("nombre_comun");
        const fechaCol = findCol("fecha");
        const horaCol = findCol("hora");
        const xCol = findCol("x");
        const yCol = findCol("y");
        const velocidadCol = findCol("velocidad");
        const cursoCol = findCol("curso");
        const altitudCol = findCol("altitud");
        const sexoCol = findCol("sexo");

        if (nombreCol === -1) return res.status(400).json({ message: "Formato Base Lunar: columna obligatoria 'nombre' no encontrada" });
        if (fechaCol === -1) return res.status(400).json({ message: "Formato Base Lunar: columna obligatoria 'fecha' no encontrada" });
        if (horaCol === -1) return res.status(400).json({ message: "Formato Base Lunar: columna obligatoria 'hora' no encontrada" });
        if (xCol === -1) return res.status(400).json({ message: "Formato Base Lunar: columna obligatoria 'x' (longitud) no encontrada" });
        if (yCol === -1) return res.status(400).json({ message: "Formato Base Lunar: columna obligatoria 'y' (latitud) no encontrada" });

        let imported = 0, duplicates = 0, errors = 0;
        const details: string[] = [];
        const individualsMap = new Map<string, { taxon?: string; sex?: string }>();
        const batchSize = 1000;
        let batch: Omit<CachedGpsEvent, "id">[] = [];

        for (let i = 1; i < lines.length; i++) {
          try {
            const vals = parseCsvLine(lines[i], separator);
            const individual = vals[nombreCol]?.trim();
            const fecha = vals[fechaCol]?.trim();
            const hora = vals[horaCol]?.trim();
            const lon = parseFloat(vals[xCol]);
            const lat = parseFloat(vals[yCol]);

            if (!individual || !fecha || !hora) {
              errors++;
              if (errors <= 10) details.push(`Fila ${i + 1}: datos obligatorios vacíos (nombre/fecha/hora)`);
              continue;
            }

            if (isNaN(lat) || isNaN(lon)) {
              errors++;
              if (errors <= 10) details.push(`Fila ${i + 1}: coordenadas x/y inválidas`);
              continue;
            }

            const ts = parseBaseLunarTimestamp(fecha, hora);
            if (isNaN(ts)) {
              errors++;
              if (errors <= 10) details.push(`Fila ${i + 1}: fecha/hora inválida "${fecha} ${hora}"`);
              continue;
            }

            const taxon = nombreComunCol >= 0 ? vals[nombreComunCol]?.trim() || undefined : undefined;
            const sex = sexoCol >= 0 ? vals[sexoCol]?.trim() || undefined : undefined;
            const existing = individualsMap.get(individual);
            if (!existing) {
              individualsMap.set(individual, { taxon, sex });
            } else {
              if (!existing.taxon && taxon) existing.taxon = taxon;
              if (!existing.sex && sex) existing.sex = sex;
            }

            batch.push({
              studyId,
              individualLocalIdentifier: individual,
              timestamp: ts,
              latitude: lat,
              longitude: lon,
              groundSpeed: velocidadCol >= 0 ? safeFloat(vals[velocidadCol]) : null,
              heading: cursoCol >= 0 ? safeFloat(vals[cursoCol]) : null,
              heightAboveEllipsoid: altitudCol >= 0 ? safeFloat(vals[altitudCol]) : null,
              hdop: null,
            });

            if (batch.length >= batchSize) {
              const result = await storage.insertCachedGpsEventsCounted(batch);
              imported += result.inserted;
              duplicates += result.duplicates;
              batch = [];
            }
          } catch (e: any) {
            errors++;
            if (errors <= 10) details.push(`Fila ${i + 1}: ${e.message}`);
          }
        }

        if (batch.length > 0) {
          const result = await storage.insertCachedGpsEventsCounted(batch);
          imported += result.inserted;
          duplicates += result.duplicates;
        }

        const metadataEntries = Array.from(individualsMap.entries()).map(([name, meta]) => ({ name, ...meta }));
        await storage.createIndividualsWithMetadata(studyId, metadataEntries);

        return res.json({
          imported, duplicates, errors, details, dataType: "gps",
          individuals: individualsMap.size,
          individuals_created: metadataEntries.length,
          format: "baselunar",
        });
      }

      if (format === "ornitella") {
        try {
          const result = await parseOrnitelaCsv(content, studyId, storage);
          return res.json({
            imported: result.gpsImported,
            accImported: result.accImported,
            duplicates: result.gpsDuplicates,
            accDuplicates: result.accDuplicates,
            errors: result.errors,
            details: result.details,
            dataType: result.dataType,
            individuals: result.individuals,
            individuals_created: result.individuals_created,
            format: "ornitella",
            ornitela_subformat: result.ornitela_subformat,
            gpsRows: result.gpsRows,
            sensorsRows: result.sensorsRows,
            isV2: result.isV2,
          });
        } catch (e: any) {
          return res.status(400).json({ message: e.message });
        }
      }

      const tsCol = findCol("timestamp");
      const indCol = findCol("individual_local_identifier", "individual.local.identifier");

      if (tsCol === -1) return res.status(400).json({ message: "Columna obligatoria no encontrada: timestamp" });
      if (indCol === -1) return res.status(400).json({ message: "Columna obligatoria no encontrada: individual-local-identifier" });

      if (dataType === "gps") {
        const latCol = findCol("location_lat", "location.lat");
        const lonCol = findCol("location_long", "location.long", "location_lon", "location.lon");
        if (latCol === -1) return res.status(400).json({ message: "Columna obligatoria no encontrada: location-lat" });
        if (lonCol === -1) return res.status(400).json({ message: "Columna obligatoria no encontrada: location-long" });

        const speedCol = findCol("ground_speed", "ground.speed");
        const headingCol = findCol("heading");
        const heightCol = findCol("height_above_ellipsoid", "height.above.ellipsoid");

        let imported = 0, duplicates = 0, errors = 0;
        const details: string[] = [];
        const individualsSet = new Set<string>();
        const batchSize = 1000;
        let batch: Omit<CachedGpsEvent, "id">[] = [];

        for (let i = 1; i < lines.length; i++) {
          try {
            const vals = parseCsvLine(lines[i], separator);
            const individual = vals[indCol]?.trim();
            const rawTs = vals[tsCol]?.trim();
            const lat = parseFloat(vals[latCol]);
            const lon = parseFloat(vals[lonCol]);

            if (!individual || !rawTs || isNaN(lat) || isNaN(lon)) {
              errors++;
              if (errors <= 10) details.push(`Fila ${i + 1}: datos inválidos o vacíos`);
              continue;
            }

            const ts = parseTimestamp(rawTs);
            if (isNaN(ts)) {
              errors++;
              if (errors <= 10) details.push(`Fila ${i + 1}: timestamp inválido "${rawTs}"`);
              continue;
            }

            individualsSet.add(individual);
            batch.push({
              studyId,
              individualLocalIdentifier: individual,
              timestamp: ts,
              latitude: lat,
              longitude: lon,
              groundSpeed: speedCol >= 0 ? safeFloat(vals[speedCol]) : null,
              heading: headingCol >= 0 ? safeFloat(vals[headingCol]) : null,
              heightAboveEllipsoid: heightCol >= 0 ? safeFloat(vals[heightCol]) : null,
              hdop: null,
            });

            if (batch.length >= batchSize) {
              const result = await storage.insertCachedGpsEventsCounted(batch);
              imported += result.inserted;
              duplicates += result.duplicates;
              batch = [];
            }
          } catch (e: any) {
            errors++;
            if (errors <= 10) details.push(`Fila ${i + 1}: ${e.message}`);
          }
        }

        if (batch.length > 0) {
          const result = await storage.insertCachedGpsEventsCounted(batch);
          imported += result.inserted;
          duplicates += result.duplicates;
        }

        await ensureIndividualsExist(studyId, individualsSet);

        return res.json({ imported, duplicates, errors, details, dataType: "gps", individuals: individualsSet.size, format: "movebank" });
      } else {
        const xCol = findCol("acceleration_x", "accelerations_raw");
        const yCol = findCol("acceleration_y");
        const zCol = findCol("acceleration_z");
        const rawCol = findCol("accelerations_raw");
        const hasXyz = xCol >= 0 && yCol >= 0 && zCol >= 0;
        const hasRaw = rawCol >= 0;

        if (!hasXyz && !hasRaw) {
          return res.status(400).json({ message: "Columnas obligatorias no encontradas: acceleration-x/y/z o accelerations-raw" });
        }

        let imported = 0, duplicates = 0, errors = 0;
        const details: string[] = [];
        const individualsSet = new Set<string>();
        const batchSize = 1000;
        let batch: Omit<CachedAccEvent, "id">[] = [];

        for (let i = 1; i < lines.length; i++) {
          try {
            const vals = parseCsvLine(lines[i], separator);
            const individual = vals[indCol]?.trim();
            const rawTs = vals[tsCol]?.trim();

            if (!individual || !rawTs) {
              errors++;
              if (errors <= 10) details.push(`Fila ${i + 1}: datos inválidos o vacíos`);
              continue;
            }

            const ts = parseTimestamp(rawTs);
            if (isNaN(ts)) {
              errors++;
              if (errors <= 10) details.push(`Fila ${i + 1}: timestamp inválido "${rawTs}"`);
              continue;
            }

            let x = 0, y = 0, z = 0;
            let rawData: string | null = null;

            if (hasXyz) {
              x = parseFloat(vals[xCol]);
              y = parseFloat(vals[yCol]);
              z = parseFloat(vals[zCol]);
              if (isNaN(x) || isNaN(y) || isNaN(z)) {
                errors++;
                if (errors <= 10) details.push(`Fila ${i + 1}: valores de aceleración inválidos`);
                continue;
              }
            } else if (hasRaw) {
              rawData = vals[rawCol]?.trim() || null;
              const parts = rawData?.split(/\s+/) || [];
              if (parts.length >= 3) {
                x = parseFloat(parts[0]);
                y = parseFloat(parts[1]);
                z = parseFloat(parts[2]);
              }
            }

            individualsSet.add(individual);
            batch.push({
              studyId,
              individualLocalIdentifier: individual,
              timestamp: ts,
              xAcceleration: x,
              yAcceleration: y,
              zAcceleration: z,
              rawData,
            });

            if (batch.length >= batchSize) {
              const result = await storage.insertCachedAccEventsCounted(batch);
              imported += result.inserted;
              duplicates += result.duplicates;
              batch = [];
            }
          } catch (e: any) {
            errors++;
            if (errors <= 10) details.push(`Fila ${i + 1}: ${e.message}`);
          }
        }

        if (batch.length > 0) {
          const result = await storage.insertCachedAccEventsCounted(batch);
          imported += result.inserted;
          duplicates += result.duplicates;
        }

        await ensureIndividualsExist(studyId, individualsSet);

        return res.json({ imported, duplicates, errors, details, dataType: "acc", individuals: individualsSet.size, format: "movebank" });
      }
    } catch (e: any) {
      log(`CSV import error: ${e.message}`, "express");
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/cache/stats", requireAuth, async (_req, res) => {
    try {
      const stats = await storage.getCacheStats();
      return res.json(stats);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
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

function parseTimestamp(raw: string): number {
  const asNum = Number(raw);
  if (!isNaN(asNum) && raw.length > 8) {
    return asNum > 1e12 ? asNum : asNum * 1000;
  }
  const d = new Date(raw);
  return d.getTime();
}

function parseBaseLunarTimestamp(fecha: string, hora: string): number {
  const cleaned = fecha.replace(/\//g, "-");
  const parts = cleaned.split("-");
  let isoDate: string;
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      isoDate = cleaned;
    } else if (parts[2].length === 4) {
      isoDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    } else {
      isoDate = cleaned;
    }
  } else {
    isoDate = cleaned;
  }
  const d = new Date(`${isoDate}T${hora}`);
  return d.getTime();
}

function safeFloat(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

async function ensureIndividualsExist(studyId: string, names: Set<string>): Promise<void> {
  const existing = await storage.getIndividuals(studyId);
  const existingNames = new Set(existing.map((i) => i.localIdentifier));
  const toCreate: string[] = [];
  names.forEach((name) => {
    if (!existingNames.has(name)) toCreate.push(name);
  });
  if (toCreate.length > 0) {
    await storage.createIndividualsByName(studyId, toCreate);
  }
}
