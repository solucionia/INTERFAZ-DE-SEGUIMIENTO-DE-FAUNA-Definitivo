import { eq, and } from "drizzle-orm";
import { db } from "./db";
import {
  users, studies, userStudies, individuals, deployments,
  type User, type InsertUser, type Study, type InsertStudy,
  type Individual, type Deployment,
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
}

export const storage = new DatabaseStorage();
