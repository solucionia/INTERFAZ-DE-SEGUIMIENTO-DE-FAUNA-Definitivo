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
    const indMbIds = new Set<number>();
    for (const ind of allInds) {
      if (ind.localIdentifier) indByLocalId.set(ind.localIdentifier, ind);
      if (ind.movebankId) {
        indByMbId.set(ind.movebankId, ind);
        indMbIds.add(ind.movebankId);
      }
    }

    const KNOWN_MAPPING: Record<number, number> = {
      7671074244:7671073892,7671078011:7671077797,7717642475:7717642002,7718135776:7718124875,
      7718160527:7718159901,7671096015:7671095581,7671279221:7671278868,7685838076:7685837946,
      7671104852:7671104364,7671108016:7671107586,7671114730:7671114391,7671118010:7671117581,
      7671122718:7671121848,7671126177:7671125665,7671129128:7671128834,7671138244:7671137650,
      7671284101:7671283661,7671141189:7671140589,7671287924:7671287394,7671144686:7671144076,
      7671297721:7671296948,7671177873:7671177195,7671189044:7671188483,7671198529:7671196916,
      7671202117:7671201469,7671209617:7671209294,7671215361:7671214957,7671307803:7671307390,
      7671570261:7671569946,7671228882:7671228224,7671313998:7671313603,7671316544:7671316270,
      7671545142:7671543875,7671536589:7671536121,7671552896:7671552193,7671082060:7671081528,
      7671561333:7671561058,7946850246:7671081528,7946855107:7664459408,7679304145:7679303683,
      7679309288:7679308909,7679312165:7679311672,7679315110:7679314232,7679318887:7679318171,
      7679322330:7679321845,7679325907:7679325268,7685800573:7685799832,7679328826:7679328428,
      7679333778:7679333262,7685806121:7685804794,7685810514:7685809785,7685812751:7685812385,
      7685815706:7685815162,7685818542:7685818258,7685820638:7685820085,7685823613:7685823136,
      7679343147:7679342721,7685826613:7685826272,7685829547:7685829302,7685833783:7685833292,
      7685836215:7685835889,7679346770:7679346208,7685840229:7685839655,7679348886:7679348433,
      7679351330:7679350917,7685843113:7685842293,7685846411:7685846128,7789455397:7789454884,
      7866910009:7866903125,7685849168:7685848658,7685851695:7685851469,7685867868:7685867589,
      7685869052:7685868835,7685870588:7685870154,7685872384:7685872131,7685874082:7685873848,
      7685875677:7685875209,7685877689:7685877341,7682462264:7682461842,7682544162:7682543597,
      7685883434:7685883038,7685884801:7685884482,7682465311:7682464628,7685887779:7685887515,
      7682470432:7682469795,7682547696:7682547030,7685892539:7685891822,7682471981:7682471750,
      7682473591:7682473227,7682552854:7682552356,7682476272:7682476003,7682556648:7682555977,
      7682478975:7682478735,7682481022:7682480582,7682484848:7682484489,7682486774:7682486418,
      7682492252:7682491977,7682496562:7682496133,7682498865:7682498512,7682560309:7682559554,
      7682569782:7682568397,7682574810:7682574167,7682577902:7682577362,7682582826:7682581655,
      7682586402:7682585798,7682589427:7682588904,7682591986:7682591559,7682594257:7682593731,
      7685633604:7685631795,7685637796:7685637197,7685640691:7685640303,7685643324:7685642894,
      7685645761:7685645183,7664459788:7664459408,7664455449:7664445827,7685647164:7685646798,
      7664467781:7664467114,7669284444:7669283861,7685648396:7685648200,7669293693:7669293286,
      7685650918:7685649950,7685653171:7685652598,7671565487:7671565181,7685654844:7685654600,
      7664487961:7664482456,7685657562:7685657221,7671572488:7671572313,7671574442:7671574002,
      7685659525:7685658995,7675116493:7675111678,7675514138:7675513120,7675575420:7675574699,
      7671578298:7671577861,7685662007:7685661599,7675120650:7675120002,7675580180:7675579067,
      7671581995:7671581699,7675128506:7675127440,7675521582:7675520363,7675584607:7675583808,
      7685663670:7685663266,7685665490:7685665125,7675133932:7675132929,7675617123:7675528652,
      7685667182:7685666876,7685669454:7685668978,7685671670:7685671358,7685673265:7685673060,
      7685675918:7685675356,7685678722:7685678357,7679128482:7679127580,7679133321:7679131697,
      7679139408:7679138393,7679164378:7679143483,7685714858:7685714184,7679170125:7679169613,
      7685719018:7685718500,7679174241:7679172402,7685722124:7685720581,7679187892:7679186330,
      7679194435:7679192479,7685725378:7685724824,7679200866:7679199419,7685729201:7685727687,
      7679204651:7679204027,7679208586:7679207864,7679213406:7679212653,7679218538:7679217678,
      7679222421:7679221689,7682001205:7682000303,7679228495:7679226209,7682004485:7682003789,
      7679233056:7679231869,7682007869:7682007269,7679236260:7679235620,7679246567:7679245575,
      7679250017:7679249107,7679254188:7679253572,7679258405:7679257669,7679265601:7679264294,
      7679267556:7679267204,7679270405:7679269505,7679273107:7679272628,7685885721:7685885531,
      7679287523:7679287148,7929272747:7671569946,7753058032:7753056348,7753065492:7753065007,
      7753070053:7753069529,7753074394:7753073975,7753077880:7753077536,7753081949:7753081467,
      7753085604:7753085249,7753088500:7753088155,7753121318:7753120580,7685890339:7685889873,
      7671070172:7671069826,7753150046:7753149811,7679355457:7679354494,7753160190:7679354494,
    };

    let repaired = 0;
    for (const dep of allDeps) {
      if (dep.individualId != null) continue;
      let indId: number | null = null;

      if (dep.localIdentifier) {
        const matched = indByLocalId.get(dep.localIdentifier);
        if (matched) indId = matched.movebankId;
      }

      if (indId == null && dep.movebankId) {
        const matched = indByMbId.get(dep.movebankId);
        if (matched) indId = matched.movebankId;
      }

      if (indId == null && KNOWN_MAPPING[dep.movebankId] !== undefined) {
        const knownIndId = KNOWN_MAPPING[dep.movebankId];
        if (indMbIds.has(knownIndId)) {
          indId = knownIndId;
        }
      }

      if (indId != null) {
        await db.update(deployments)
          .set({ individualId: indId })
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
