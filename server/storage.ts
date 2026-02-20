import { eq, and, desc, gte, lte, inArray, count, sql } from "drizzle-orm";
import { db } from "./db";
import { encrypt, decrypt } from "./encryption";
import {
  users, studies, userStudies, individuals, deployments,
  speciesProfiles, detectedEvents, alertLogs, emissionAlerts, cronLogs, savedAnalyses, activityLogs,
  cachedGpsEvents, cachedAccEvents, cachedFetchRanges,
  type User, type InsertUser, type Study, type InsertStudy,
  type Individual, type Deployment,
  type SpeciesProfile, type InsertSpeciesProfile,
  type DetectedEvent, type InsertDetectedEvent,
  type EmissionAlert, type InsertEmissionAlert,
  type SavedAnalysis, type InsertSavedAnalysis,
  type ActivityLog, type InsertActivityLog,
  type CachedGpsEvent, type CachedAccEvent, type CachedFetchRange,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser & { role?: string }): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUserCount(): Promise<number>;

  getAllStudies(): Promise<Study[]>;
  getStudy(id: string): Promise<Study | undefined>;
  getStudyDecrypted(id: string): Promise<Study | undefined>;
  createStudy(study: InsertStudy): Promise<Study>;
  updateStudy(id: string, study: Partial<InsertStudy>): Promise<Study | undefined>;
  deleteStudy(id: string): Promise<void>;

  getStudiesForUser(userId: string): Promise<Study[]>;
  getUsersForStudy(studyId: string): Promise<string[]>;
  assignUserToStudy(userId: string, studyId: string): Promise<void>;
  removeUserFromStudy(userId: string, studyId: string): Promise<void>;

  getIndividuals(studyId: string): Promise<Individual[]>;
  getIndividualById(id: string): Promise<Individual | undefined>;
  getAllIndividualsForUser(userId: string): Promise<(Individual & { studyName: string })[]>;
  upsertIndividuals(studyId: string, data: Omit<Individual, "id">[]): Promise<void>;
  updateIndividual(id: string, data: Partial<Pick<Individual, "nickName" | "sex" | "animalLifeStage">>): Promise<Individual | undefined>;
  getDeployments(studyId: string): Promise<Deployment[]>;
  upsertDeployments(studyId: string, data: Omit<Deployment, "id">[]): Promise<void>;
  createDeploymentForIndividual(data: { studyId: string; movebankId: number; individualId: number; deployOn: string; deployOff: string | null }): Promise<Deployment>;
  updateDeploymentStatus(id: string, data: { deployOff: string | null }): Promise<Deployment | undefined>;
  repairDeploymentsLocal(studyId: string): Promise<{ total: number; linked: number; repaired: number; unlinked: number }>;

  getAllSpeciesProfiles(): Promise<SpeciesProfile[]>;
  getSpeciesProfile(id: string): Promise<SpeciesProfile | undefined>;
  createSpeciesProfile(profile: InsertSpeciesProfile): Promise<SpeciesProfile>;
  updateSpeciesProfile(id: string, data: Partial<InsertSpeciesProfile>): Promise<SpeciesProfile | undefined>;
  deleteSpeciesProfile(id: string): Promise<void>;

  getDetectedEvents(studyId: string, timestampStart?: number, timestampEnd?: number): Promise<DetectedEvent[]>;
  createDetectedEvent(event: InsertDetectedEvent): Promise<DetectedEvent>;
  deleteDetectedEventsForStudy(studyId: string): Promise<void>;

  getAlertLog(eventId: string, email: string): Promise<boolean>;
  createAlertLog(eventId: string, email: string): Promise<void>;

  getEmissionAlertsForUser(userId: string): Promise<EmissionAlert[]>;
  getAllActiveEmissionAlerts(): Promise<EmissionAlert[]>;
  createEmissionAlert(alert: InsertEmissionAlert): Promise<EmissionAlert>;
  updateEmissionAlert(id: string, data: Partial<InsertEmissionAlert>): Promise<EmissionAlert | undefined>;
  deleteEmissionAlert(id: string): Promise<void>;
  updateEmissionAlertLastSent(id: string): Promise<void>;

  getActiveStudiesWithDeployments(): Promise<{ study: Study; activeIndividuals: { localIdentifier: string; movebankId: number }[] }[]>;

  createCronLog(taskType: string, status: string, details?: string): Promise<void>;

  getSavedAnalyses(studyId: string, userId: string): Promise<SavedAnalysis[]>;
  getSavedAnalysis(id: string): Promise<SavedAnalysis | undefined>;
  createSavedAnalysis(analysis: InsertSavedAnalysis): Promise<SavedAnalysis>;
  deleteSavedAnalysis(id: string): Promise<void>;

  updateUser(id: string, data: Partial<{ name: string; email: string; alertEmail: string | null }>): Promise<User | undefined>;

  updateDetectedEvent(id: string, data: Partial<{ readStatus: boolean; resolvedStatus: boolean }>): Promise<DetectedEvent | undefined>;
  getAllDetectedEvents(filters?: {
    studyId?: string;
    eventType?: string;
    individualLocalId?: string;
    readStatus?: boolean;
    resolvedStatus?: boolean;
    timestampStart?: number;
    timestampEnd?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ events: DetectedEvent[]; total: number }>;
  getDetectedEventStats(studyIds: string[]): Promise<Record<string, number>>;

  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(filters?: { userId?: string; limit?: number; offset?: number }): Promise<{ logs: ActivityLog[]; total: number }>;

  getDashboardSummary(studyIds: string[]): Promise<{
    totalAnimals: number;
    recentAlerts: DetectedEvent[];
    alertCountsByType: Record<string, number>;
  }>;

  getCachedGpsEvents(studyId: string, individual: string, tsStart: number, tsEnd: number): Promise<CachedGpsEvent[]>;
  insertCachedGpsEvents(events: Omit<CachedGpsEvent, "id">[]): Promise<void>;
  getCachedAccEvents(studyId: string, individual: string, tsStart: number, tsEnd: number): Promise<CachedAccEvent[]>;
  insertCachedAccEvents(events: Omit<CachedAccEvent, "id">[]): Promise<void>;
  getCachedTimestampRange(studyId: string, individual: string, sensorType: "gps" | "acc"): Promise<{ min: number; max: number } | null>;
  getCacheStats(): Promise<{ totalGps: number; totalAcc: number; byStudy: { studyId: string; studyName: string; gpsCount: number; accCount: number; lastGpsTimestamp: number | null; lastAccTimestamp: number | null }[] }>;
  clearCacheForStudy(studyId: string): Promise<void>;
  recordFetchedRange(studyId: string, individual: string, sensorType: string, rangeStart: number, rangeEnd: number): Promise<void>;
  getFetchedRanges(studyId: string, individual: string, sensorType: string): Promise<{ rangeStart: number; rangeEnd: number }[]>;
  computeUncoveredGaps(studyId: string, individual: string, sensorType: string, tsStart: number, tsEnd: number): Promise<{ start: number; end: number }[]>;

  insertCachedGpsEventsCounted(events: Omit<CachedGpsEvent, "id">[]): Promise<{ inserted: number; duplicates: number }>;
  insertCachedAccEventsCounted(events: Omit<CachedAccEvent, "id">[]): Promise<{ inserted: number; duplicates: number }>;
  createIndividualsByName(studyId: string, names: string[]): Promise<void>;
  createIndividualsWithMetadata(studyId: string, entries: { name: string; taxon?: string; sex?: string }[]): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser & { role?: string }): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getUserCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(users);
    return Number(result.count);
  }

  async getAllStudies(): Promise<Study[]> {
    return db.select().from(studies);
  }

  async getStudy(id: string): Promise<Study | undefined> {
    const [study] = await db.select().from(studies).where(eq(studies.id, id));
    return study;
  }

  async createStudy(study: InsertStudy): Promise<Study> {
    const encrypted = {
      ...study,
      movebankUsername: encrypt(study.movebankUsername),
      movebankPassword: encrypt(study.movebankPassword),
    };
    const [created] = await db.insert(studies).values(encrypted).returning();
    return created;
  }

  async updateStudy(id: string, data: Partial<InsertStudy>): Promise<Study | undefined> {
    const toUpdate = { ...data };
    if (toUpdate.movebankUsername) {
      toUpdate.movebankUsername = encrypt(toUpdate.movebankUsername);
    }
    if (toUpdate.movebankPassword) {
      toUpdate.movebankPassword = encrypt(toUpdate.movebankPassword);
    }
    const [updated] = await db.update(studies).set(toUpdate).where(eq(studies.id, id)).returning();
    return updated;
  }

  async getStudyDecrypted(id: string): Promise<Study | undefined> {
    const study = await this.getStudy(id);
    if (!study) return undefined;
    return {
      ...study,
      movebankUsername: decrypt(study.movebankUsername),
      movebankPassword: decrypt(study.movebankPassword),
    };
  }

  async deleteStudy(id: string): Promise<void> {
    await db.delete(studies).where(eq(studies.id, id));
  }

  async getStudiesForUser(userId: string): Promise<Study[]> {
    const assignments = await db.select().from(userStudies).where(eq(userStudies.userId, userId));
    if (assignments.length === 0) return [];
    const studyIds = assignments.map((a) => a.studyId);
    const result: Study[] = [];
    for (const sid of studyIds) {
      const [s] = await db.select().from(studies).where(eq(studies.id, sid));
      if (s) result.push(s);
    }
    return result;
  }

  async getUsersForStudy(studyId: string): Promise<string[]> {
    const assignments = await db.select().from(userStudies).where(eq(userStudies.studyId, studyId));
    return assignments.map((a) => a.userId);
  }

  async assignUserToStudy(userId: string, studyId: string): Promise<void> {
    const existing = await db.select().from(userStudies)
      .where(and(eq(userStudies.userId, userId), eq(userStudies.studyId, studyId)));
    if (existing.length === 0) {
      await db.insert(userStudies).values({ userId, studyId });
    }
  }

  async removeUserFromStudy(userId: string, studyId: string): Promise<void> {
    await db.delete(userStudies)
      .where(and(eq(userStudies.userId, userId), eq(userStudies.studyId, studyId)));
  }

  async getIndividuals(studyId: string): Promise<Individual[]> {
    return db.select().from(individuals).where(eq(individuals.studyId, studyId));
  }

  async getAllIndividualsForUser(userId: string): Promise<(Individual & { studyName: string })[]> {
    const user = await this.getUser(userId);
    if (!user) return [];

    if (user.role === "superuser") {
      const rows = await db
        .select({
          id: individuals.id,
          studyId: individuals.studyId,
          movebankId: individuals.movebankId,
          localIdentifier: individuals.localIdentifier,
          nickName: individuals.nickName,
          taxonCanonicalName: individuals.taxonCanonicalName,
          sex: individuals.sex,
          animalLifeStage: individuals.animalLifeStage,
          synced: individuals.synced,
          studyName: studies.name,
        })
        .from(individuals)
        .innerJoin(studies, eq(individuals.studyId, studies.id));
      return rows as (Individual & { studyName: string })[];
    }

    const rows = await db
      .select({
        id: individuals.id,
        studyId: individuals.studyId,
        movebankId: individuals.movebankId,
        localIdentifier: individuals.localIdentifier,
        nickName: individuals.nickName,
        taxonCanonicalName: individuals.taxonCanonicalName,
        sex: individuals.sex,
        animalLifeStage: individuals.animalLifeStage,
        synced: individuals.synced,
        studyName: studies.name,
      })
      .from(individuals)
      .innerJoin(studies, eq(individuals.studyId, studies.id))
      .innerJoin(userStudies, eq(studies.id, userStudies.studyId))
      .where(eq(userStudies.userId, userId));
    return rows as (Individual & { studyName: string })[];
  }

  async upsertIndividuals(studyId: string, data: Omit<Individual, "id">[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(individuals)
        .set({ synced: false })
        .where(eq(individuals.studyId, studyId));

      for (const row of data) {
        await tx.insert(individuals)
          .values({ ...row, synced: true })
          .onConflictDoUpdate({
            target: [individuals.studyId, individuals.movebankId],
            set: {
              localIdentifier: row.localIdentifier,
              nickName: row.nickName,
              taxonCanonicalName: row.taxonCanonicalName,
              sex: row.sex,
              animalLifeStage: row.animalLifeStage,
              synced: true,
            },
          });
      }
    });
  }

  async getDeployments(studyId: string): Promise<Deployment[]> {
    return db.select().from(deployments).where(eq(deployments.studyId, studyId));
  }

  async upsertDeployments(studyId: string, data: Omit<Deployment, "id">[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(deployments)
        .set({ synced: false })
        .where(eq(deployments.studyId, studyId));

      for (const row of data) {
        await tx.insert(deployments)
          .values({ ...row, synced: true })
          .onConflictDoUpdate({
            target: [deployments.studyId, deployments.movebankId],
            set: {
              individualId: row.individualId,
              localIdentifier: row.localIdentifier,
              deployOn: row.deployOn,
              deployOff: row.deployOff,
              synced: true,
            },
          });
      }
    });
  }

  async getIndividualById(id: string): Promise<Individual | undefined> {
    const [ind] = await db.select().from(individuals).where(eq(individuals.id, id));
    return ind;
  }

  async updateIndividual(id: string, data: Partial<Pick<Individual, "nickName" | "sex" | "animalLifeStage">>): Promise<Individual | undefined> {
    const [updated] = await db.update(individuals).set(data).where(eq(individuals.id, id)).returning();
    return updated;
  }

  async createDeploymentForIndividual(data: { studyId: string; movebankId: number; individualId: number; deployOn: string; deployOff: string | null }): Promise<Deployment> {
    const [dep] = await db.insert(deployments).values({
      studyId: data.studyId,
      movebankId: data.movebankId,
      individualId: data.individualId,
      deployOn: data.deployOn,
      deployOff: data.deployOff,
      synced: false,
    }).returning();
    return dep;
  }

  async updateDeploymentStatus(id: string, data: { deployOff: string | null }): Promise<Deployment | undefined> {
    const [updated] = await db.update(deployments).set(data).where(eq(deployments.id, id)).returning();
    return updated;
  }

  async repairDeploymentsLocal(studyId: string): Promise<{ total: number; linked: number; repaired: number; unlinked: number }> {
    const allDeps = await this.getDeployments(studyId);
    const allInds = await this.getIndividuals(studyId);
    const total = allDeps.length;
    const alreadyLinked = allDeps.filter(d => d.individualId != null).length;

    const indByLocalId = new Map<string, Individual>();
    const indByMbId = new Map<number, Individual>();
    for (const ind of allInds) {
      if (ind.localIdentifier) indByLocalId.set(ind.localIdentifier, ind);
      if (ind.movebankId) indByMbId.set(ind.movebankId, ind);
    }

    let repaired = 0;
    for (const dep of allDeps) {
      if (dep.individualId != null) continue;
      let matchedInd: Individual | undefined;
      if (dep.localIdentifier) {
        matchedInd = indByLocalId.get(dep.localIdentifier);
      }
      if (!matchedInd && dep.movebankId) {
        matchedInd = indByMbId.get(dep.movebankId);
      }
      if (matchedInd) {
        await db.update(deployments)
          .set({ individualId: matchedInd.movebankId })
          .where(eq(deployments.id, dep.id));
        repaired++;
      }
    }

    const linked = alreadyLinked + repaired;
    const unlinked = total - linked;
    return { total, linked, repaired, unlinked };
  }

  async getAllSpeciesProfiles(): Promise<SpeciesProfile[]> {
    return db.select().from(speciesProfiles);
  }

  async getSpeciesProfile(id: string): Promise<SpeciesProfile | undefined> {
    const [profile] = await db.select().from(speciesProfiles).where(eq(speciesProfiles.id, id));
    return profile;
  }

  async createSpeciesProfile(profile: InsertSpeciesProfile): Promise<SpeciesProfile> {
    const [created] = await db.insert(speciesProfiles).values(profile).returning();
    return created;
  }

  async updateSpeciesProfile(id: string, data: Partial<InsertSpeciesProfile>): Promise<SpeciesProfile | undefined> {
    const [updated] = await db.update(speciesProfiles).set(data).where(eq(speciesProfiles.id, id)).returning();
    return updated;
  }

  async deleteSpeciesProfile(id: string): Promise<void> {
    await db.delete(speciesProfiles).where(eq(speciesProfiles.id, id));
  }

  async getDetectedEvents(studyId: string, timestampStart?: number, timestampEnd?: number): Promise<DetectedEvent[]> {
    let conditions = [eq(detectedEvents.studyId, studyId)];
    if (timestampStart !== undefined) {
      conditions.push(gte(detectedEvents.timestampStart, timestampStart));
    }
    if (timestampEnd !== undefined) {
      conditions.push(lte(detectedEvents.timestampEnd, timestampEnd));
    }
    return db.select().from(detectedEvents)
      .where(and(...conditions))
      .orderBy(desc(detectedEvents.timestampStart));
  }

  async createDetectedEvent(event: InsertDetectedEvent): Promise<DetectedEvent> {
    const [created] = await db.insert(detectedEvents).values(event as any).returning();
    return created;
  }

  async deleteDetectedEventsForStudy(studyId: string): Promise<void> {
    await db.delete(detectedEvents).where(eq(detectedEvents.studyId, studyId));
  }

  async getAlertLog(eventId: string, email: string): Promise<boolean> {
    const [existing] = await db.select().from(alertLogs)
      .where(and(eq(alertLogs.detectedEventId, eventId), eq(alertLogs.email, email)));
    return !!existing;
  }

  async createAlertLog(eventId: string, email: string): Promise<void> {
    await db.insert(alertLogs).values({ detectedEventId: eventId, email });
  }

  async getEmissionAlertsForUser(userId: string): Promise<EmissionAlert[]> {
    return db.select().from(emissionAlerts).where(eq(emissionAlerts.userId, userId));
  }

  async getAllActiveEmissionAlerts(): Promise<EmissionAlert[]> {
    return db.select().from(emissionAlerts).where(eq(emissionAlerts.active, true));
  }

  async createEmissionAlert(alert: InsertEmissionAlert): Promise<EmissionAlert> {
    const [created] = await db.insert(emissionAlerts).values(alert).returning();
    return created;
  }

  async updateEmissionAlert(id: string, data: Partial<InsertEmissionAlert>): Promise<EmissionAlert | undefined> {
    const [updated] = await db.update(emissionAlerts).set(data).where(eq(emissionAlerts.id, id)).returning();
    return updated;
  }

  async deleteEmissionAlert(id: string): Promise<void> {
    await db.delete(emissionAlerts).where(eq(emissionAlerts.id, id));
  }

  async updateEmissionAlertLastSent(id: string): Promise<void> {
    await db.update(emissionAlerts).set({ lastSentAt: new Date() }).where(eq(emissionAlerts.id, id));
  }

  async getActiveStudiesWithDeployments(): Promise<{ study: Study; activeIndividuals: { localIdentifier: string; movebankId: number }[] }[]> {
    const allStudies = await db.select().from(studies).where(eq(studies.active, true));
    const results: { study: Study; activeIndividuals: { localIdentifier: string; movebankId: number }[] }[] = [];

    for (const study of allStudies) {
      const deps = await db.select().from(deployments).where(eq(deployments.studyId, study.id));
      const activeDeps = deps.filter((d) => !d.deployOff);
      const activeIndividualIds = new Set(activeDeps.map((d) => d.individualId).filter(Boolean));

      const inds = await db.select().from(individuals).where(eq(individuals.studyId, study.id));
      const activeInds = inds
        .filter((ind) => activeIndividualIds.has(ind.movebankId) && ind.localIdentifier)
        .map((ind) => ({ localIdentifier: ind.localIdentifier!, movebankId: ind.movebankId }));

      if (activeInds.length > 0) {
        results.push({ study, activeIndividuals: activeInds });
      }
    }

    return results;
  }

  async createCronLog(taskType: string, status: string, details?: string): Promise<void> {
    await db.insert(cronLogs).values({ taskType, status, details });
  }

  async getSavedAnalyses(studyId: string, userId: string): Promise<SavedAnalysis[]> {
    return db.select().from(savedAnalyses)
      .where(and(eq(savedAnalyses.studyId, studyId), eq(savedAnalyses.userId, userId)))
      .orderBy(desc(savedAnalyses.createdAt));
  }

  async getSavedAnalysis(id: string): Promise<SavedAnalysis | undefined> {
    const [analysis] = await db.select().from(savedAnalyses).where(eq(savedAnalyses.id, id));
    return analysis;
  }

  async createSavedAnalysis(analysis: InsertSavedAnalysis): Promise<SavedAnalysis> {
    const [created] = await db.insert(savedAnalyses).values(analysis as any).returning();
    return created;
  }

  async deleteSavedAnalysis(id: string): Promise<void> {
    await db.delete(savedAnalyses).where(eq(savedAnalyses.id, id));
  }

  async updateUser(id: string, data: Partial<{ name: string; email: string; alertEmail: string | null }>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async updateDetectedEvent(id: string, data: Partial<{ readStatus: boolean; resolvedStatus: boolean }>): Promise<DetectedEvent | undefined> {
    const [updated] = await db.update(detectedEvents).set(data).where(eq(detectedEvents.id, id)).returning();
    return updated;
  }

  async getAllDetectedEvents(filters?: {
    studyId?: string;
    eventType?: string;
    individualLocalId?: string;
    readStatus?: boolean;
    resolvedStatus?: boolean;
    timestampStart?: number;
    timestampEnd?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ events: DetectedEvent[]; total: number }> {
    const conditions: any[] = [];
    if (filters?.studyId) conditions.push(eq(detectedEvents.studyId, filters.studyId));
    if (filters?.eventType) conditions.push(eq(detectedEvents.eventType, filters.eventType));
    if (filters?.individualLocalId) conditions.push(eq(detectedEvents.individualLocalId, filters.individualLocalId));
    if (filters?.readStatus !== undefined) conditions.push(eq(detectedEvents.readStatus, filters.readStatus));
    if (filters?.resolvedStatus !== undefined) conditions.push(eq(detectedEvents.resolvedStatus, filters.resolvedStatus));
    if (filters?.timestampStart) conditions.push(gte(detectedEvents.timestampStart, filters.timestampStart));
    if (filters?.timestampEnd) conditions.push(lte(detectedEvents.timestampEnd, filters.timestampEnd));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: count() }).from(detectedEvents).where(whereClause);
    const total = totalResult?.count || 0;

    let query = db.select().from(detectedEvents).where(whereClause).orderBy(desc(detectedEvents.createdAt));
    if (filters?.limit) query = query.limit(filters.limit) as any;
    if (filters?.offset) query = query.offset(filters.offset) as any;

    const events = await query;
    return { events, total };
  }

  async getDetectedEventStats(studyIds: string[]): Promise<Record<string, number>> {
    if (studyIds.length === 0) return {};
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const events = await db.select().from(detectedEvents)
      .where(and(
        inArray(detectedEvents.studyId, studyIds),
        gte(detectedEvents.timestampStart, thirtyDaysAgo)
      ));
    const stats: Record<string, number> = {};
    for (const e of events) {
      stats[e.eventType] = (stats[e.eventType] || 0) + 1;
    }
    return stats;
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [created] = await db.insert(activityLogs).values(log).returning();
    return created;
  }

  async getActivityLogs(filters?: { userId?: string; limit?: number; offset?: number }): Promise<{ logs: ActivityLog[]; total: number }> {
    const conditions: any[] = [];
    if (filters?.userId) conditions.push(eq(activityLogs.userId, filters.userId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: count() }).from(activityLogs).where(whereClause);
    const total = totalResult?.count || 0;

    let query = db.select().from(activityLogs).where(whereClause).orderBy(desc(activityLogs.createdAt));
    if (filters?.limit) query = query.limit(filters.limit) as any;
    if (filters?.offset) query = query.offset(filters.offset) as any;

    const logs = await query;
    return { logs, total };
  }

  async getDashboardSummary(studyIds: string[]): Promise<{
    totalAnimals: number;
    recentAlerts: DetectedEvent[];
    alertCountsByType: Record<string, number>;
  }> {
    let totalAnimals = 0;
    if (studyIds.length > 0) {
      const inds = await db.select().from(individuals).where(inArray(individuals.studyId, studyIds));
      totalAnimals = inds.length;
    }

    const recentAlerts = studyIds.length > 0
      ? await db.select().from(detectedEvents)
          .where(inArray(detectedEvents.studyId, studyIds))
          .orderBy(desc(detectedEvents.createdAt))
          .limit(10)
      : [];

    const alertCountsByType = await this.getDetectedEventStats(studyIds);

    return { totalAnimals, recentAlerts, alertCountsByType };
  }

  async getCachedGpsEvents(studyId: string, individual: string, tsStart: number, tsEnd: number): Promise<CachedGpsEvent[]> {
    return db.select().from(cachedGpsEvents)
      .where(and(
        eq(cachedGpsEvents.studyId, studyId),
        eq(cachedGpsEvents.individualLocalIdentifier, individual),
        gte(cachedGpsEvents.timestamp, tsStart),
        lte(cachedGpsEvents.timestamp, tsEnd)
      ))
      .orderBy(cachedGpsEvents.timestamp);
  }

  async insertCachedGpsEvents(events: Omit<CachedGpsEvent, "id">[]): Promise<void> {
    if (events.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      await db.insert(cachedGpsEvents).values(batch).onConflictDoNothing();
    }
  }

  async getCachedAccEvents(studyId: string, individual: string, tsStart: number, tsEnd: number): Promise<CachedAccEvent[]> {
    return db.select().from(cachedAccEvents)
      .where(and(
        eq(cachedAccEvents.studyId, studyId),
        eq(cachedAccEvents.individualLocalIdentifier, individual),
        gte(cachedAccEvents.timestamp, tsStart),
        lte(cachedAccEvents.timestamp, tsEnd)
      ))
      .orderBy(cachedAccEvents.timestamp);
  }

  async insertCachedAccEvents(events: Omit<CachedAccEvent, "id">[]): Promise<void> {
    if (events.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      await db.insert(cachedAccEvents).values(batch).onConflictDoNothing();
    }
  }

  async getCachedTimestampRange(studyId: string, individual: string, sensorType: "gps" | "acc"): Promise<{ min: number; max: number } | null> {
    const table = sensorType === "gps" ? cachedGpsEvents : cachedAccEvents;
    const idCol = sensorType === "gps" ? cachedGpsEvents.individualLocalIdentifier : cachedAccEvents.individualLocalIdentifier;
    const studyCol = sensorType === "gps" ? cachedGpsEvents.studyId : cachedAccEvents.studyId;
    const tsCol = sensorType === "gps" ? cachedGpsEvents.timestamp : cachedAccEvents.timestamp;

    const result = await db.select({
      minTs: sql<number>`MIN(${tsCol})`,
      maxTs: sql<number>`MAX(${tsCol})`,
    }).from(table)
      .where(and(eq(studyCol, studyId), eq(idCol, individual)));

    if (!result[0] || result[0].minTs === null) return null;
    return { min: Number(result[0].minTs), max: Number(result[0].maxTs) };
  }

  async getCacheStats(): Promise<{ totalGps: number; totalAcc: number; byStudy: { studyId: string; studyName: string; gpsCount: number; accCount: number; lastGpsTimestamp: number | null; lastAccTimestamp: number | null }[] }> {
    const [gpsTotal] = await db.select({ count: count() }).from(cachedGpsEvents);
    const [accTotal] = await db.select({ count: count() }).from(cachedAccEvents);

    const allStudies = await db.select().from(studies);
    const byStudy: { studyId: string; studyName: string; gpsCount: number; accCount: number; lastGpsTimestamp: number | null; lastAccTimestamp: number | null }[] = [];

    for (const study of allStudies) {
      const [gps] = await db.select({
        count: count(),
        maxTs: sql<number>`MAX(${cachedGpsEvents.timestamp})`,
      }).from(cachedGpsEvents).where(eq(cachedGpsEvents.studyId, study.id));

      const [acc] = await db.select({
        count: count(),
        maxTs: sql<number>`MAX(${cachedAccEvents.timestamp})`,
      }).from(cachedAccEvents).where(eq(cachedAccEvents.studyId, study.id));

      if ((gps?.count || 0) > 0 || (acc?.count || 0) > 0) {
        byStudy.push({
          studyId: study.id,
          studyName: study.name,
          gpsCount: gps?.count || 0,
          accCount: acc?.count || 0,
          lastGpsTimestamp: gps?.maxTs ? Number(gps.maxTs) : null,
          lastAccTimestamp: acc?.maxTs ? Number(acc.maxTs) : null,
        });
      }
    }

    return {
      totalGps: gpsTotal?.count || 0,
      totalAcc: accTotal?.count || 0,
      byStudy,
    };
  }

  async clearCacheForStudy(studyId: string): Promise<void> {
    await db.delete(cachedGpsEvents).where(eq(cachedGpsEvents.studyId, studyId));
    await db.delete(cachedAccEvents).where(eq(cachedAccEvents.studyId, studyId));
    await db.delete(cachedFetchRanges).where(eq(cachedFetchRanges.studyId, studyId));
  }

  async recordFetchedRange(studyId: string, individual: string, sensorType: string, rangeStart: number, rangeEnd: number): Promise<void> {
    const existing = await db.select()
      .from(cachedFetchRanges)
      .where(and(
        eq(cachedFetchRanges.studyId, studyId),
        eq(cachedFetchRanges.individualLocalIdentifier, individual),
        eq(cachedFetchRanges.sensorType, sensorType),
      ))
      .orderBy(cachedFetchRanges.rangeStart);

    const merged: { start: number; end: number }[] = [];
    const allRanges = [...existing.map(r => ({ start: r.rangeStart, end: r.rangeEnd })), { start: rangeStart, end: rangeEnd }];
    allRanges.sort((a, b) => a.start - b.start);

    for (const range of allRanges) {
      if (merged.length === 0 || range.start > merged[merged.length - 1].end + 1) {
        merged.push({ ...range });
      } else {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end);
      }
    }

    await db.delete(cachedFetchRanges).where(and(
      eq(cachedFetchRanges.studyId, studyId),
      eq(cachedFetchRanges.individualLocalIdentifier, individual),
      eq(cachedFetchRanges.sensorType, sensorType),
    ));

    for (const r of merged) {
      await db.insert(cachedFetchRanges).values({
        studyId,
        individualLocalIdentifier: individual,
        sensorType,
        rangeStart: r.start,
        rangeEnd: r.end,
      });
    }
  }

  async getFetchedRanges(studyId: string, individual: string, sensorType: string): Promise<{ rangeStart: number; rangeEnd: number }[]> {
    const rows = await db.select()
      .from(cachedFetchRanges)
      .where(and(
        eq(cachedFetchRanges.studyId, studyId),
        eq(cachedFetchRanges.individualLocalIdentifier, individual),
        eq(cachedFetchRanges.sensorType, sensorType),
      ))
      .orderBy(cachedFetchRanges.rangeStart);
    return rows.map(r => ({ rangeStart: r.rangeStart, rangeEnd: r.rangeEnd }));
  }

  async computeUncoveredGaps(studyId: string, individual: string, sensorType: string, tsStart: number, tsEnd: number): Promise<{ start: number; end: number }[]> {
    const ranges = await this.getFetchedRanges(studyId, individual, sensorType);
    if (ranges.length === 0) return [{ start: tsStart, end: tsEnd }];

    const gaps: { start: number; end: number }[] = [];
    let current = tsStart;

    for (const range of ranges) {
      if (range.rangeStart > current) {
        gaps.push({ start: current, end: Math.min(range.rangeStart - 1, tsEnd) });
      }
      current = Math.max(current, range.rangeEnd + 1);
      if (current > tsEnd) break;
    }

    if (current <= tsEnd) {
      gaps.push({ start: current, end: tsEnd });
    }

    return gaps.filter(g => g.start <= g.end);
  }

  async insertCachedGpsEventsCounted(events: Omit<CachedGpsEvent, "id">[]): Promise<{ inserted: number; duplicates: number }> {
    if (events.length === 0) return { inserted: 0, duplicates: 0 };
    let totalInserted = 0;
    const batchSize = 500;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      const result = await db.insert(cachedGpsEvents).values(batch).onConflictDoNothing();
      const insertedCount = (result as any).rowCount ?? batch.length;
      totalInserted += insertedCount;
    }
    return { inserted: totalInserted, duplicates: events.length - totalInserted };
  }

  async insertCachedAccEventsCounted(events: Omit<CachedAccEvent, "id">[]): Promise<{ inserted: number; duplicates: number }> {
    if (events.length === 0) return { inserted: 0, duplicates: 0 };
    let totalInserted = 0;
    const batchSize = 500;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      const result = await db.insert(cachedAccEvents).values(batch).onConflictDoNothing();
      const insertedCount = (result as any).rowCount ?? batch.length;
      totalInserted += insertedCount;
    }
    return { inserted: totalInserted, duplicates: events.length - totalInserted };
  }

  async createIndividualsByName(studyId: string, names: string[]): Promise<void> {
    for (const name of names) {
      await db.insert(individuals).values({
        studyId,
        movebankId: 0,
        localIdentifier: name,
        synced: false,
      }).onConflictDoNothing();
    }
  }

  async createIndividualsWithMetadata(studyId: string, entries: { name: string; taxon?: string; sex?: string }[]): Promise<void> {
    const existing = await this.getIndividuals(studyId);
    const existingNames = new Set(existing.map((i) => i.localIdentifier));
    for (const entry of entries) {
      if (existingNames.has(entry.name)) {
        if (entry.taxon || entry.sex) {
          await db.update(individuals)
            .set({
              ...(entry.taxon ? { taxonCanonicalName: entry.taxon } : {}),
              ...(entry.sex ? { sex: entry.sex } : {}),
            })
            .where(and(
              eq(individuals.studyId, studyId),
              eq(individuals.localIdentifier, entry.name)
            ));
        }
      } else {
        await db.insert(individuals).values({
          studyId,
          movebankId: 0,
          localIdentifier: entry.name,
          taxonCanonicalName: entry.taxon || null,
          sex: entry.sex || null,
          synced: false,
        }).onConflictDoNothing();
        existingNames.add(entry.name);
      }
    }
  }
}

export const storage = new DatabaseStorage();
