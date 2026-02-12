import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireSuperuser } from "./auth";
import { fetchMovebankIndividuals, fetchMovebankDeployments } from "./movebank";
import { registerSchema, insertStudySchema } from "@shared/schema";
import { log } from "./index";

async function requireStudyAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "No autenticado" });
  }
  const user = req.user!;
  if (user.role === "superuser") return next();

  const studyId = req.params.id || req.params.studyId;
  const userStudyIds = (await storage.getStudiesForUser(user.id)).map((s) => s.id);
  if (!userStudyIds.includes(studyId)) {
    return res.status(403).json({ message: "Acceso denegado a este estudio" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  app.post("/api/auth/register", async (req, res, next) => {
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

  app.post("/api/auth/login", (req, res, next) => {
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

  app.get("/api/studies", requireAuth, async (req, res) => {
    const user = req.user!;
    if (user.role === "superuser") {
      return res.json(await storage.getAllStudies());
    }
    return res.json(await storage.getStudiesForUser(user.id));
  });

  app.get("/api/studies/:id", requireStudyAccess, async (req, res) => {
    const study = await storage.getStudy(req.params.id);
    if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
    return res.json(study);
  });

  app.post("/api/studies", requireSuperuser, async (req, res) => {
    try {
      const parsed = insertStudySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }
      const study = await storage.createStudy(parsed.data);
      return res.json(study);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/studies/:id", requireSuperuser, async (req, res) => {
    const study = await storage.updateStudy(req.params.id, req.body);
    if (!study) return res.status(404).json({ message: "Estudio no encontrado" });
    return res.json(study);
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

  app.get("/api/studies/:id/individuals", requireStudyAccess, async (req, res) => {
    const individuals = await storage.getIndividuals(req.params.id);
    return res.json(individuals);
  });

  app.get("/api/studies/:id/deployments", requireStudyAccess, async (req, res) => {
    const deployments = await storage.getDeployments(req.params.id);
    return res.json(deployments);
  });

  app.post("/api/studies/:id/sync", requireStudyAccess, async (req, res) => {
    try {
      const study = await storage.getStudy(req.params.id);
      if (!study) return res.status(404).json({ message: "Estudio no encontrado" });

      log(`Syncing study ${study.name} (${study.movebankStudyId})`, "movebank");

      const [rawIndividuals, rawDeployments] = await Promise.all([
        fetchMovebankIndividuals(study.movebankStudyId, study.movebankUsername, study.movebankPassword),
        fetchMovebankDeployments(study.movebankStudyId, study.movebankUsername, study.movebankPassword),
      ]);

      const individualsData = rawIndividuals.map((r) => ({
        studyId: study.id,
        movebankId: parseInt(r.id || r.individual_id || "0", 10),
        localIdentifier: r.local_identifier || null,
        nickName: r.nick_name || null,
        taxonCanonicalName: r.taxon_canonical_name || null,
        sex: r.sex || null,
        animalLifeStage: r.animal_life_stage || null,
      }));

      const deploymentsData = rawDeployments.map((r) => ({
        studyId: study.id,
        movebankId: parseInt(r.id || r.deployment_id || "0", 10),
        individualId: r.individual_id ? parseInt(r.individual_id, 10) : null,
        localIdentifier: r.local_identifier || null,
        deployOn: r.deploy_on_timestamp || r.deploy_on_date || null,
        deployOff: r.deploy_off_timestamp || r.deploy_off_date || null,
      }));

      await Promise.all([
        storage.upsertIndividuals(study.id, individualsData),
        storage.upsertDeployments(study.id, deploymentsData),
      ]);

      log(`Synced: ${individualsData.length} individuals, ${deploymentsData.length} deployments`, "movebank");

      return res.json({
        individuals: individualsData.length,
        deployments: deploymentsData.length,
      });
    } catch (e: any) {
      log(`Sync error: ${e.message}`, "movebank");
      return res.status(500).json({ message: `Error al sincronizar: ${e.message}` });
    }
  });

  return httpServer;
}
