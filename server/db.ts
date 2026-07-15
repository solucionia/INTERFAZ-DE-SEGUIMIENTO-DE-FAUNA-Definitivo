import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

try {
  const dbHost = new URL(process.env.DATABASE_URL || "").hostname;
  console.log(`DB HOST ACTIVO: ${dbHost}`);
} catch {
  console.log("DB HOST ACTIVO: (DATABASE_URL no válida o ausente)");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export { pool };
