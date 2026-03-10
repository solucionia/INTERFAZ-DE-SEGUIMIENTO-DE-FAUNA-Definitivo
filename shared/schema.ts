import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, bigint, timestamp, jsonb, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
  alertEmail: text("alert_email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, role: true, createdAt: true });
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
  movebankStudyId: bigint("movebank_study_id", { mode: "number" }),
  movebankUsername: text("movebank_username"),
  movebankPassword: text("movebank_password"),
  alertEmail: text("alert_email"),
  speciesProfileId: varchar("species_profile_id"),
  active: boolean("active").notNull().default(true),
  ornitelaEnabled: boolean("ornitela_enabled").notNull().default(false),
  ornitelaUsername: text("ornitela_username"),
  ornitelaPassword: text("ornitela_password"),
  ornitelaLastSync: timestamp("ornitela_last_sync"),
  ornitelaSyncIntervalHours: integer("ornitela_sync_interval_hours").notNull().default(6),
  ornitelaPanelUrl: text("ornitela_panel_url").notNull().default("https://cpanel.glosendas.net"),
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
  synced: boolean("synced").notNull().default(true),
}, (table) => [
  uniqueIndex("individuals_study_movebank_unique").on(table.studyId, table.movebankId),
]);

export type Individual = typeof individuals.$inferSelect;

export const deployments = pgTable("deployments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  movebankId: bigint("movebank_id", { mode: "number" }).notNull(),
  individualId: bigint("individual_id", { mode: "number" }),
  localIdentifier: text("local_identifier"),
  deployOn: text("deploy_on_date"),
  deployOff: text("deploy_off_date"),
  synced: boolean("synced").notNull().default(true),
}, (table) => [
  uniqueIndex("deployments_study_movebank_unique").on(table.studyId, table.movebankId),
]);

export type Deployment = typeof deployments.$inferSelect;

export const eventThresholdsSchema = z.object({
  mortality: z.object({
    enabled: z.boolean().default(true),
    stationaryVariance: z.number().default(50),
    durationHours: z.number().default(24),
  }),
  detachment: z.object({
    enabled: z.boolean().default(true),
    xThresholdHigh: z.number().default(200),
    xThresholdLow: z.number().default(-200),
    minPositions: z.number().default(5),
    windowSize: z.number().default(10),
  }),
  fight: z.object({
    enabled: z.boolean().default(true),
    zThreshold: z.number().default(-300),
    minOccurrences: z.number().default(2),
    windowMinutes: z.number().default(120),
  }),
  feeding: z.object({
    enabled: z.boolean().default(true),
    yThreshold: z.number().default(150),
    minOccurrences: z.number().default(2),
    windowMinutes: z.number().default(20),
  }),
  incubation: z.object({
    enabled: z.boolean().default(true),
    yRangeLow: z.number().default(-200),
    yRangeHigh: z.number().default(200),
    minStdDev: z.number().default(30),
    windowMinutes: z.number().default(60),
    minSignChanges: z.number().default(3),
  }),
});

export type EventThresholds = z.infer<typeof eventThresholdsSchema>;

export const DEFAULT_THRESHOLDS: EventThresholds = {
  mortality: { enabled: true, stationaryVariance: 50, durationHours: 24 },
  detachment: { enabled: true, xThresholdHigh: 200, xThresholdLow: -200, minPositions: 5, windowSize: 10 },
  fight: { enabled: true, zThreshold: -300, minOccurrences: 2, windowMinutes: 120 },
  feeding: { enabled: true, yThreshold: 150, minOccurrences: 2, windowMinutes: 20 },
  incubation: { enabled: true, yRangeLow: -200, yRangeHigh: 200, minStdDev: 30, windowMinutes: 60, minSignChanges: 3 },
};

export function normalizeThresholds(stored: any): EventThresholds {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_THRESHOLDS };
  const d = DEFAULT_THRESHOLDS;
  return {
    mortality: { ...d.mortality, ...stored.mortality },
    detachment: { ...d.detachment, ...stored.detachment },
    fight: { ...d.fight, ...stored.fight },
    feeding: { ...d.feeding, ...stored.feeding },
    incubation: {
      ...d.incubation,
      ...stored.incubation,
      ...(stored.incubation?.minVariance !== undefined && stored.incubation?.minStdDev === undefined
        ? { minStdDev: stored.incubation.minVariance }
        : {}),
    },
  };
}

export const speciesProfiles = pgTable("species_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  thresholds: jsonb("thresholds").notNull().$type<EventThresholds>(),
});

export const insertSpeciesProfileSchema = createInsertSchema(speciesProfiles).omit({ id: true }).extend({
  thresholds: eventThresholdsSchema,
});
export type InsertSpeciesProfile = z.infer<typeof insertSpeciesProfileSchema>;
export type SpeciesProfile = typeof speciesProfiles.$inferSelect;

export const EVENT_TYPES = ["mortality", "detachment", "fight", "feeding", "incubation"] as const;
export type EventType = typeof EVENT_TYPES[number];

export const EVENT_SEVERITY: Record<EventType, string> = {
  mortality: "critical",
  detachment: "warning",
  fight: "warning",
  feeding: "info",
  incubation: "info",
};

export const EVENT_COLORS: Record<EventType, string> = {
  mortality: "#ef4444",
  detachment: "#f97316",
  fight: "#f97316",
  feeding: "#22c55e",
  incubation: "#3b82f6",
};

export const EVENT_LABELS: Record<EventType, string> = {
  mortality: "Mortalidad",
  detachment: "Desprendimiento del emisor",
  fight: "Pelea / Depredación",
  feeding: "Alimentación",
  incubation: "Incubación / Vuelo",
};

export const detectedEvents = pgTable("detected_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  individualLocalId: text("individual_local_id").notNull(),
  eventType: text("event_type").notNull().$type<EventType>(),
  severity: text("severity").notNull(),
  timestampStart: bigint("timestamp_start", { mode: "number" }).notNull(),
  timestampEnd: bigint("timestamp_end", { mode: "number" }).notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accValues: jsonb("acc_values").$type<{ x: number; y: number; z: number }[]>(),
  description: text("description"),
  readStatus: boolean("read_status").notNull().default(false),
  resolvedStatus: boolean("resolved_status").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DetectedEvent = typeof detectedEvents.$inferSelect;
export const insertDetectedEventSchema = createInsertSchema(detectedEvents).omit({ id: true, createdAt: true });
export type InsertDetectedEvent = z.infer<typeof insertDetectedEventSchema>;

export const alertLogs = pgTable("alert_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  detectedEventId: varchar("detected_event_id").notNull().references(() => detectedEvents.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const emissionAlerts = pgTable("emission_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  daysThreshold: integer("days_threshold").notNull().default(3),
  email: text("email").notNull(),
  active: boolean("active").notNull().default(true),
  lastSentAt: timestamp("last_sent_at"),
});

export const insertEmissionAlertSchema = createInsertSchema(emissionAlerts).omit({ id: true, lastSentAt: true });
export type InsertEmissionAlert = z.infer<typeof insertEmissionAlertSchema>;
export type EmissionAlert = typeof emissionAlerts.$inferSelect;

export const cronLogs = pgTable("cron_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskType: text("task_type").notNull(),
  status: text("status").notNull(),
  details: text("details"),
  runAt: timestamp("run_at").defaultNow(),
});

export const ANALYSIS_TYPES = ["mcp", "kernel", "distance", "speed", "comprehensive"] as const;
export type AnalysisType = typeof ANALYSIS_TYPES[number];

export const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  mcp: "Home Range (MCP)",
  kernel: "Home Range (Kernel)",
  distance: "Distancia recorrida",
  speed: "Velocidad de movimiento",
  comprehensive: "Analisis completo",
};

export const savedAnalyses = pgTable("saved_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  analysisType: text("analysis_type").notNull().$type<AnalysisType>(),
  individuals: text("individuals").array().notNull(),
  timestampStart: bigint("timestamp_start", { mode: "number" }).notNull(),
  timestampEnd: bigint("timestamp_end", { mode: "number" }).notNull(),
  params: jsonb("params").$type<Record<string, any>>(),
  resultData: jsonb("result_data").$type<Record<string, any>>(),
  resultGeojson: jsonb("result_geojson").$type<any>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSavedAnalysisSchema = createInsertSchema(savedAnalyses).omit({ id: true, createdAt: true });
export type InsertSavedAnalysis = z.infer<typeof insertSavedAnalysisSchema>;
export type SavedAnalysis = typeof savedAnalyses.$inferSelect;

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  resource: text("resource"),
  resourceId: varchar("resource_id"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ActivityLog = typeof activityLogs.$inferSelect;
export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

export const cachedGpsEvents = pgTable("cached_gps_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  individualLocalIdentifier: text("individual_local_identifier").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  groundSpeed: doublePrecision("ground_speed"),
  heading: doublePrecision("heading"),
  heightAboveEllipsoid: doublePrecision("height_above_ellipsoid"),
}, (table) => [
  uniqueIndex("cached_gps_unique").on(table.studyId, table.individualLocalIdentifier, table.timestamp),
]);

export type CachedGpsEvent = typeof cachedGpsEvents.$inferSelect;

export const cachedAccEvents = pgTable("cached_acc_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  individualLocalIdentifier: text("individual_local_identifier").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  xAcceleration: doublePrecision("x_acceleration").notNull(),
  yAcceleration: doublePrecision("y_acceleration").notNull(),
  zAcceleration: doublePrecision("z_acceleration").notNull(),
  rawData: text("raw_data"),
}, (table) => [
  uniqueIndex("cached_acc_unique").on(table.studyId, table.individualLocalIdentifier, table.timestamp),
]);

export type CachedAccEvent = typeof cachedAccEvents.$inferSelect;

export const cachedFetchRanges = pgTable("cached_fetch_ranges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studyId: varchar("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  individualLocalIdentifier: text("individual_local_identifier").notNull(),
  sensorType: text("sensor_type").notNull(),
  rangeStart: bigint("range_start", { mode: "number" }).notNull(),
  rangeEnd: bigint("range_end", { mode: "number" }).notNull(),
});

export type CachedFetchRange = typeof cachedFetchRanges.$inferSelect;
