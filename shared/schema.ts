import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, role: true });
export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});
export const registerSchema = insertUserSchema.extend({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const studies = pgTable("studies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  movebankStudyId: bigint("movebank_study_id", { mode: "number" }).notNull(),
  movebankUsername: text("movebank_username").notNull(),
  movebankPassword: text("movebank_password").notNull(),
  alertEmail: text("alert_email"),
  active: boolean("active").notNull().default(true),
});

export const insertStudySchema = createInsertSchema(studies).omit({ id: true });
export type InsertStudy = z.infer<typeof insertStudySchema>;
export type Study = typeof studies.$inferSelect;

export const userStudies = pgTable("user_studies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
});

export const insertUserStudySchema = createInsertSchema(userStudies).omit({ id: true });
export type InsertUserStudy = z.infer<typeof insertUserStudySchema>;
export type UserStudy = typeof userStudies.$inferSelect;

export const individuals = pgTable("individuals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  movebankId: bigint("movebank_id", { mode: "number" }).notNull(),
  localIdentifier: text("local_identifier"),
  nickName: text("nick_name"),
  taxonCanonicalName: text("taxon_canonical_name"),
  sex: text("sex"),
  animalLifeStage: text("animal_life_stage"),
});

export type Individual = typeof individuals.$inferSelect;

export const deployments = pgTable("deployments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  movebankId: bigint("movebank_id", { mode: "number" }).notNull(),
  individualId: bigint("individual_id", { mode: "number" }),
  localIdentifier: text("local_identifier"),
  deployOn: text("deploy_on_date"),
  deployOff: text("deploy_off_date"),
});

export type Deployment = typeof deployments.$inferSelect;
