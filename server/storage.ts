import { eq, and, desc, gte, lte, inArray, count, sql } from "drizzle-orm";
import { db } from "./db";
import {
  users, studies, userStudies, individuals, deployments,
  speciesProfiles, detectedEvents, alertLogs, emissionAlerts, cronLogs, savedAnalyses, activityLogs,
  type User, type InsertUser, type Study, type InsertStudy,
  type Individual, type Deployment,
  type SpeciesProfile, type InsertSpeciesProfile,
  type DetectedEvent, type InsertDetectedEvent,
  type EmissionAlert, type InsertEmissionAlert,
  type SavedAnalysis, type InsertSavedAnalysis,
  type ActivityLog, type InsertActivityLog,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser & { role?: string }): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUserCount(): Promise<number>;

  getAllStudies(): Promise<Study[]>;
  getStudy(id: string): Promise<Study | undefined>;
  createStudy(study: InsertStudy): Promise<Study>;
  updateStudy(id: string, study: Partial<InsertStudy>): Promise<Study | undefined>;
  deleteStudy(id: string): Promise<void>;

  getStudiesForUser(userId: string): Promise<Study[]>;
  getUsersForStudy(studyId: string): Promise<string[]>;
  assignUserToStudy(userId: string, studyId: string): Promise<void>;
  removeUserFromStudy(userId: string, studyId: string): Promise<void>;

  getIndividuals(studyId: string): Promise<Individual[]>;
  upsertIndividuals(studyId: string, data: Omit<Individual, "id">[]): Promise<void>;
  getDeployments(studyId: string): Promise<Deployment[]>;
  upsertDeployments(studyId: string, data: Omit<Deployment, "id">[]): Promise<void>;

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
    const result = await db.select().from(users);
    return result.length;
  }

  async getAllStudies(): Promise<Study[]> {
    return db.select().from(studies);
  }

  async getStudy(id: string): Promise<Study | undefined> {
    const [study] = await db.select().from(studies).where(eq(studies.id, id));
    return study;
  }

  async createStudy(study: InsertStudy): Promise<Study> {
    const [created] = await db.insert(studies).values(study).returning();
    return created;
  }

  async updateStudy(id: string, data: Partial<InsertStudy>): Promise<Study | undefined> {
    const [updated] = await db.update(studies).set(data).where(eq(studies.id, id)).returning();
    return updated;
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

  async upsertIndividuals(studyId: string, data: Omit<Individual, "id">[]): Promise<void> {
    await db.delete(individuals).where(eq(individuals.studyId, studyId));
    if (data.length > 0) {
      await db.insert(individuals).values(data);
    }
  }

  async getDeployments(studyId: string): Promise<Deployment[]> {
    return db.select().from(deployments).where(eq(deployments.studyId, studyId));
  }

  async upsertDeployments(studyId: string, data: Omit<Deployment, "id">[]): Promise<void> {
    await db.delete(deployments).where(eq(deployments.studyId, studyId));
    if (data.length > 0) {
      await db.insert(deployments).values(data);
    }
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
}

export const storage = new DatabaseStorage();
