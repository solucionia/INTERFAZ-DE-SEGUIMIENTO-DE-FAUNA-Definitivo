import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import bcrypt from "bcryptjs";
import multer from "multer";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireSuperuser } from "./auth";
import { fetchMovebankIndividuals, fetchMovebankDeployments, fetchMovebankEvents, MovebankError } from "./movebank";
import { registerSchema, insertStudySchema, insertSpeciesProfileSchema, insertEmissionAlertSchema, DEFAULT_THRESHOLDS, type EventThresholds, ANALYSIS_TYPES, type AnalysisType, EVENT_TYPES, type CachedGpsEvent, type CachedAccEvent, type Study } from "@shared/schema";
import { detectEvents } from "./eventDetection";
import { sendEventAlert } from "./emailService";
import { runAnalysis, KERNEL_PERCENTAGES, MCP_PERCENTAGES } from "./geoAnalysis";
import { decrypt } from "./encryption";
import { log } from "./index";
import { authLimiter, apiLimiter, movebankLimiter } from "./rateLimiter";

function maskStudyCredentials(study: Study): Study {
  return {
    ...study,
    movebankUsername: "••••••••",
    movebankPassword: "••••••••",
  };
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

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
      const user = await storage.createUser({ name, email, password: hashed, alertEmail: req.body.alertEmail || null });
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
    const { alertEmail } = req.body;
    const updated = await storage.updateUser(req.params.id, { alertEmail });
    if (!updated) return res.status(404).json({ message: "Usuario no encontrado" });
    const { password: _, ...safe } = updated;
    return res.json(safe);
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

  app.get("/api/studies/:id/export-kml", requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id);
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
        const gpsEvents = await fetchMovebankEvents(study.movebankStudyId, study.movebankUsername, study.movebankPassword, animalId.trim(), 653, tsStart, tsEnd);
        const coords = gpsEvents
          .filter((r) => r.location_lat && r.location_long)
          .map((r) => `${r.location_long},${r.location_lat},0`)
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
      if (e instanceof MovebankError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
      return res.status(500).json({ message: e.message });
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
    const study = await storage.getStudy(req.params.id);
    if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
    return res.json(maskStudyCredentials(study));
  });

  app.post("/api/studies", requireSuperuser, async (req, res) => {
    try {
      const parsed = insertStudySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }
      const study = await storage.createStudy(parsed.data);
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

  app.get("/api/studies/:id/individuals", requireStudyAccess, async (req, res) => {
    const individuals = await storage.getIndividuals(req.params.id);
    return res.json(individuals);
  });

  app.get("/api/studies/:id/deployments", requireStudyAccess, async (req, res) => {
    const deployments = await storage.getDeployments(req.params.id);
    return res.json(deployments);
  });

  app.get("/api/studies/:id/events", movebankLimiter, requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id);
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

      const results: Record<string, Record<string, string>[]> = {};

      let rateLimitError: { message: string } | null = null;

      await Promise.all(
        ids.map(async (animalId) => {
          const trimmed = animalId.trim();
          try {
            if (!forceReload && (isGps || isAcc)) {
              const sensorKey = isGps ? "gps" as const : "acc" as const;

              const gaps = await storage.computeUncoveredGaps(study.id, trimmed, sensorKey, tsStart, tsEnd);

              if (gaps.length === 0) {
                if (isGps) {
                  const cached = await storage.getCachedGpsEvents(study.id, trimmed, tsStart, tsEnd);
                  results[trimmed] = cached.map((c) => ({
                    timestamp: new Date(c.timestamp).toISOString(),
                    location_lat: String(c.latitude),
                    location_long: String(c.longitude),
                    ground_speed: c.groundSpeed != null ? String(c.groundSpeed) : "",
                    heading: c.heading != null ? String(c.heading) : "",
                    height_above_ellipsoid: c.heightAboveEllipsoid != null ? String(c.heightAboveEllipsoid) : "",
                    individual_local_identifier: trimmed,
                  }));
                } else {
                  const cached = await storage.getCachedAccEvents(study.id, trimmed, tsStart, tsEnd);
                  results[trimmed] = cached.map((c) => ({
                    timestamp: new Date(c.timestamp).toISOString(),
                    acceleration_x: String(c.xAcceleration),
                    acceleration_y: String(c.yAcceleration),
                    acceleration_z: String(c.zAcceleration),
                    individual_local_identifier: trimmed,
                    ...(c.rawData ? { accelerations_raw: c.rawData } : {}),
                  }));
                }
                log(`Cache HIT for ${trimmed} (${sensorKey}) - ${results[trimmed].length} records`, "cache");
                return;
              }

              let movebankRows: Record<string, string>[] = [];
              for (const gap of gaps) {
                const rows = await fetchMovebankEvents(
                  study.movebankStudyId, study.movebankUsername, study.movebankPassword,
                  trimmed, sensorTypeId, gap.start, gap.end
                );
                movebankRows = movebankRows.concat(rows);
              }

              if (movebankRows.length > 0) {
                if (isGps) {
                  const toCache = movebankRows
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
                    }))
                    .filter((p) => !isNaN(p.timestamp) && !isNaN(p.latitude) && !isNaN(p.longitude));
                  await storage.insertCachedGpsEvents(toCache);
                } else {
                  const toCache: { studyId: string; individualLocalIdentifier: string; timestamp: number; xAcceleration: number; yAcceleration: number; zAcceleration: number; rawData: string | null }[] = [];
                  for (const r of movebankRows) {
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
                  await storage.insertCachedAccEvents(toCache);
                }
                log(`Cached ${movebankRows.length} new ${sensorKey} records for ${trimmed}`, "cache");
              }

              for (const gap of gaps) {
                await storage.recordFetchedRange(study.id, trimmed, sensorKey, gap.start, gap.end);
              }

              if (isGps) {
                const allCached = await storage.getCachedGpsEvents(study.id, trimmed, tsStart, tsEnd);
                results[trimmed] = allCached.map((c) => ({
                  timestamp: new Date(c.timestamp).toISOString(),
                  location_lat: String(c.latitude),
                  location_long: String(c.longitude),
                  ground_speed: c.groundSpeed != null ? String(c.groundSpeed) : "",
                  heading: c.heading != null ? String(c.heading) : "",
                  height_above_ellipsoid: c.heightAboveEllipsoid != null ? String(c.heightAboveEllipsoid) : "",
                  individual_local_identifier: trimmed,
                }));
              } else {
                const allCached = await storage.getCachedAccEvents(study.id, trimmed, tsStart, tsEnd);
                results[trimmed] = allCached.map((c) => ({
                  timestamp: new Date(c.timestamp).toISOString(),
                  acceleration_x: String(c.xAcceleration),
                  acceleration_y: String(c.yAcceleration),
                  acceleration_z: String(c.zAcceleration),
                  individual_local_identifier: trimmed,
                  ...(c.rawData ? { accelerations_raw: c.rawData } : {}),
                }));
              }
            } else {
              const events = await fetchMovebankEvents(
                study.movebankStudyId, study.movebankUsername, study.movebankPassword,
                trimmed, sensorTypeId, tsStart, tsEnd
              );

              if (forceReload && (isGps || isAcc)) {
                if (isGps) {
                  const toCache = events
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
                    }))
                    .filter((p) => !isNaN(p.timestamp) && !isNaN(p.latitude) && !isNaN(p.longitude));
                  await storage.insertCachedGpsEvents(toCache);
                } else {
                  const toCache: { studyId: string; individualLocalIdentifier: string; timestamp: number; xAcceleration: number; yAcceleration: number; zAcceleration: number; rawData: string | null }[] = [];
                  for (const r of events) {
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
                  await storage.insertCachedAccEvents(toCache);
                }
                log(`Force-cached ${events.length} ${isGps ? "gps" : "acc"} records for ${trimmed}`, "cache");
                const forceKey = isGps ? "gps" : "acc";
                await storage.recordFetchedRange(study.id, trimmed, forceKey, tsStart, tsEnd);
              }

              results[trimmed] = events;
            }
          } catch (e: any) {
            log(`Events fetch error for ${trimmed}: ${e.message}`, "movebank");
            if (e instanceof MovebankError && e.statusCode === 429) {
              rateLimitError = e;
            } else {
              results[trimmed] = [];
            }
          }
        })
      );

      if (rateLimitError) {
        return res.status(429).json({ message: rateLimitError.message });
      }

      return res.json(results);
    } catch (e: any) {
      log(`Events error: ${e.message}`, "movebank");
      if (e instanceof MovebankError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
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

  // Detected events
  app.get("/api/studies/:id/detected-events", requireStudyAccess, async (req, res) => {
    const { timestamp_start, timestamp_end } = req.query;
    const tsStart = timestamp_start ? parseInt(timestamp_start as string, 10) : undefined;
    const tsEnd = timestamp_end ? parseInt(timestamp_end as string, 10) : undefined;
    const events = await storage.getDetectedEvents(req.params.id, tsStart, tsEnd);
    return res.json(events);
  });

  // Detect events (trigger analysis)
  app.post("/api/studies/:id/detect-events", movebankLimiter, requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      const { individuals: individualIds, timestamp_start, timestamp_end } = req.body;
      if (!individualIds || !timestamp_start || !timestamp_end) {
        return res.status(400).json({ message: "Parámetros requeridos: individuals, timestamp_start, timestamp_end" });
      }

      let thresholds: EventThresholds = DEFAULT_THRESHOLDS;
      if (study.speciesProfileId) {
        const profile = await storage.getSpeciesProfile(study.speciesProfileId);
        if (profile) {
          thresholds = profile.thresholds as EventThresholds;
        }
      }

      const ids = (individualIds as string).split(",").map((s: string) => s.trim());
      const tsStart = parseInt(timestamp_start as string, 10);
      const tsEnd = parseInt(timestamp_end as string, 10);

      let totalEvents = 0;
      let emailsSent = 0;

      for (const animalId of ids) {
        try {
          const [gpsRows, accRows] = await Promise.all([
            fetchMovebankEvents(study.movebankStudyId, study.movebankUsername, study.movebankPassword, animalId, 653, tsStart, tsEnd),
            fetchMovebankEvents(study.movebankStudyId, study.movebankUsername, study.movebankPassword, animalId, 2365683, tsStart, tsEnd),
          ]);

          const gpsSamples = gpsRows
            .filter((r) => r.location_lat && r.location_long)
            .map((r) => ({
              timestamp: new Date(r.timestamp).getTime(),
              lat: parseFloat(r.location_lat),
              lng: parseFloat(r.location_long),
            }))
            .filter((p) => !isNaN(p.lat) && !isNaN(p.lng) && !isNaN(p.timestamp));

          const accSamples: { timestamp: number; x: number; y: number; z: number }[] = [];
          for (const r of accRows) {
            const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
            const ts = new Date(r.timestamp).getTime();
            if (isNaN(ts)) continue;
            if (rawAxes) {
              const vals = rawAxes.split(/\s+/).map(Number);
              for (let i = 0; i + 2 < vals.length; i += 3) {
                if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
                  accSamples.push({ timestamp: ts + i * 10, x: vals[i], y: vals[i + 1], z: vals[i + 2] });
                }
              }
            } else {
              accSamples.push({
                timestamp: ts,
                x: parseFloat(r.acceleration_x || "0"),
                y: parseFloat(r.acceleration_y || "0"),
                z: parseFloat(r.acceleration_z || "0"),
              });
            }
          }

          const detected = detectEvents(accSamples, gpsSamples, thresholds, study.id, animalId);

          for (const event of detected) {
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
      const cutoffMs = days * 24 * 60 * 60 * 1000;

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

      for (const { study, activeIndividuals } of accessibleStudies) {
        const decryptedUsername = decrypt(study.movebankUsername);
        const decryptedPassword = decrypt(study.movebankPassword);
        for (const animal of activeIndividuals) {
          try {
            const recentWindow = now - cutoffMs * 2;
            const gpsEvents = await fetchMovebankEvents(
              study.movebankStudyId,
              decryptedUsername,
              decryptedPassword,
              animal.localIdentifier,
              653,
              recentWindow,
              now
            );

            let lastTs: number | null = null;
            let lastLat: number | null = null;
            let lastLng: number | null = null;

            for (const ev of gpsEvents) {
              const ts = new Date(ev.timestamp).getTime();
              if (!isNaN(ts) && (lastTs === null || ts > lastTs)) {
                lastTs = ts;
                if (ev.location_lat && ev.location_long) {
                  const lat = parseFloat(ev.location_lat);
                  const lng = parseFloat(ev.location_long);
                  if (!isNaN(lat) && !isNaN(lng)) {
                    lastLat = lat;
                    lastLng = lng;
                  }
                }
              }
            }

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
            if (e instanceof MovebankError && e.statusCode === 429) {
              return res.status(429).json({ message: e.message });
            }
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
      if (e instanceof MovebankError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
      return res.status(500).json({ message: `Error en monitor de emision: ${e.message}` });
    }
  });

  // Emission alerts CRUD
  app.get("/api/emission-alerts", requireAuth, async (req, res) => {
    const alerts = await storage.getEmissionAlertsForUser(req.user!.id);
    return res.json(alerts);
  });

  app.post("/api/emission-alerts", requireAuth, async (req, res) => {
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

  app.patch("/api/emission-alerts/:id", requireAuth, async (req, res) => {
    const alert = await storage.updateEmissionAlert(req.params.id, req.body);
    if (!alert) return res.status(404).json({ message: "Alerta no encontrada" });
    return res.json(alert);
  });

  app.delete("/api/emission-alerts/:id", requireAuth, async (req, res) => {
    await storage.deleteEmissionAlert(req.params.id);
    return res.json({ ok: true });
  });

  app.post("/api/studies/:id/sync", movebankLimiter, requireStudyAccess, async (req, res) => {
    try {
      log(`Sync iniciado para estudio: ${req.params.id}`, "movebank");
      const study = await storage.getStudyDecrypted(req.params.id);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      log(`Conectando con Movebank, study_id: ${study.movebankStudyId}, estudio: ${study.name}`, "movebank");

      const rawIndividuals = await fetchMovebankIndividuals(study.movebankStudyId, study.movebankUsername, study.movebankPassword);
      log(`Movebank respondió individuos: ${rawIndividuals.length}`, "movebank");

      const rawDeployments = await fetchMovebankDeployments(study.movebankStudyId, study.movebankUsername, study.movebankPassword);
      log(`Movebank respondió despliegues: ${rawDeployments.length}`, "movebank");

      const individualsData = rawIndividuals.map((r) => ({
        studyId: study.id,
        movebankId: parseInt(r.id || r.individual_id || "0", 10),
        localIdentifier: r.local_identifier || null,
        nickName: r.nick_name || null,
        taxonCanonicalName: r.taxon_canonical_name || null,
        sex: r.sex || null,
        animalLifeStage: r.animal_life_stage || null,
        synced: true,
      }));

      const deploymentsData = rawDeployments.map((r) => ({
        studyId: study.id,
        movebankId: parseInt(r.id || r.deployment_id || "0", 10),
        individualId: r.individual_id ? parseInt(r.individual_id, 10) : null,
        localIdentifier: r.local_identifier || null,
        deployOn: r.deploy_on_timestamp || r.deploy_on_date || null,
        deployOff: r.deploy_off_timestamp || r.deploy_off_date || null,
        synced: true,
      }));

      await Promise.all([
        storage.upsertIndividuals(study.id, individualsData),
        storage.upsertDeployments(study.id, deploymentsData),
      ]);

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

  // Geospatial Analysis
  app.post("/api/studies/:id/analysis", requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudyDecrypted(req.params.id);
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
        const gpsEvents = await fetchMovebankEvents(
          study.movebankStudyId,
          study.movebankUsername,
          study.movebankPassword,
          animalId,
          653,
          timestampStart,
          timestampEnd
        );

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
      }

      if (allGpsRows.length < 2) {
        return res.status(400).json({ message: "No se encontraron datos GPS suficientes en el rango seleccionado" });
      }

      const resultData = runAnalysis(analysisType, allGpsRows, params);

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

  app.get("/api/studies/:id/analyses", requireStudyAccess, async (req, res) => {
    const analyses = await storage.getSavedAnalyses(req.params.id, req.user!.id);
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

  app.get("/api/analyses/:id/export-csv", requireAuth, async (req, res) => {
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
        const headers = [
          "",
          "localizaciones",
          "dias_analisis",
          "total_recorrido",
          "distancia_minima_entre_localizaciones",
          "distancia_maxima_entre_localizaciones",
          "p_fecha",
          "u_fecha",
          "escentricidad",
          "Linearity",
          "minima_distancia_dia",
          "maxima_distancia_dia",
          "media_distancia_dia",
          "h",
        ];

        if (resultData.bandwidthMethod === "lscv" || resultData.bandwidthMethod === "both") {
          headers.push("h_lscv");
        }

        for (const pct of KERNEL_PERCENTAGES) {
          headers.push(`hr_area${pct}`);
        }

        for (const pct of MCP_PERCENTAGES) {
          headers.push(`mcp_area${pct}`);
        }

        csv = headers.join(",") + "\n";

        for (const ind of resultData.perIndividual) {
          const fmtDate = (isoStr: string) => {
            if (!isoStr) return "";
            const d = new Date(isoStr);
            return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
          };

          const row: any[] = [
            ind.individual,
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
            ind.hHref,
          ];

          if (resultData.bandwidthMethod === "lscv" || resultData.bandwidthMethod === "both") {
            row.push(ind.hLscv ?? "");
          }

          for (const pct of KERNEL_PERCENTAGES) {
            const km2 = ind.kernelHrefAreas?.[`${pct}`];
            row.push(km2 != null ? km2 * 1e6 : "");
          }

          for (const pct of MCP_PERCENTAGES) {
            const km2 = ind.mcpAreas?.[`${pct}`];
            row.push(km2 != null ? km2 * 1e6 : "");
          }

          csv += row.join(",") + "\n";
        }
      } else if (resultData?.analysisType === "mcp") {
        csv = "Animal,Area_km2\n";
        for (const a of resultData.areas || []) {
          csv += `${a.individual},${a.area_km2}\n`;
        }
      } else if (resultData?.analysisType === "kernel") {
        csv = "Animal,Area_95_km2,Area_50_km2\n";
        for (const a of resultData.areas || []) {
          csv += `${a.individual},${a.area_95_km2},${a.area_50_km2}\n`;
        }
      } else if (resultData?.analysisType === "distance") {
        csv = "Animal,Fecha,Distancia_km\n";
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

  app.get("/api/analyses/:id/export-hrref", requireAuth, async (req, res) => {
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

      let csv = "Animal,porcentaje,hr_area_m2,hr_area_km2\n";
      for (const ind of resultData.perIndividual) {
        for (const pct of KERNEL_PERCENTAGES) {
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

  app.get("/api/analyses/:id/export-mpc", requireAuth, async (req, res) => {
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

  app.get("/api/analyses/:id/export-geojson", requireAuth, async (req, res) => {
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

  app.delete("/api/analyses/:id", requireAuth, async (req, res) => {
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

  app.post("/api/studies/:id/import-csv", requireStudyAccess, upload.single("file"), async (req, res) => {
    try {
      const studyId = req.params.id;
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

      const hasBaseLunarCols = findCol("nombre") >= 0 && findCol("fecha") >= 0 && findCol("hora") >= 0 && findCol("x") >= 0 && findCol("y") >= 0;
      const hasMovebankCols = findCol("timestamp") >= 0 && findCol("individual_local_identifier", "individual.local.identifier") >= 0;

      let detectedFormat: "movebank" | "baselunar" = "movebank";
      if (hasBaseLunarCols) {
        detectedFormat = "baselunar";
      } else if (hasSemicolon && !hasMovebankCols) {
        detectedFormat = "baselunar";
      }

      const format = requestedFormat === "auto" ? detectedFormat : (requestedFormat as "movebank" | "baselunar");

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
