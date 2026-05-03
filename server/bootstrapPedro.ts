import bcrypt from "bcryptjs";
import { db } from "./db";
import { users, cronLogs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { log } from "./index";

const MARKER_TASK = "bootstrap_pedro_v1";
const TARGET_EMAIL = "pedro@solucionia.ai";
const TARGET_NAME = "Pedro";
const TARGET_ROLE = "superuser";
const TARGET_PASSWORD = "123456";

export async function bootstrapPedro() {
  try {
    const [marker] = await db
      .select({ id: cronLogs.id })
      .from(cronLogs)
      .where(and(eq(cronLogs.taskType, MARKER_TASK), eq(cronLogs.status, "success")))
      .limit(1);

    if (marker) {
      return;
    }

    const hash = await bcrypt.hash(TARGET_PASSWORD, 10);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, TARGET_EMAIL))
      .limit(1);

    if (existing) {
      await db
        .update(users)
        .set({ password: hash, role: TARGET_ROLE, name: TARGET_NAME })
        .where(eq(users.id, existing.id));
      log(`bootstrap: usuario ${TARGET_EMAIL} actualizado (password reset, role=${TARGET_ROLE})`, "bootstrap");
    } else {
      await db.insert(users).values({
        email: TARGET_EMAIL,
        name: TARGET_NAME,
        password: hash,
        role: TARGET_ROLE,
      } as any);
      log(`bootstrap: usuario ${TARGET_EMAIL} creado como ${TARGET_ROLE}`, "bootstrap");
    }

    await db.insert(cronLogs).values({
      taskType: MARKER_TASK,
      status: "success",
      details: existing ? "updated" : "created",
    });
  } catch (e: any) {
    try {
      await db.insert(cronLogs).values({
        taskType: MARKER_TASK,
        status: "error",
        details: String(e?.message || e),
      });
    } catch {}
    log(`bootstrap: error en bootstrapPedro: ${e?.message || e}`, "bootstrap");
  }
}
