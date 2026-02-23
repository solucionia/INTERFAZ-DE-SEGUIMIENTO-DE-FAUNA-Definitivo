import { db } from "./db";
import { studies } from "@shared/schema";
import { encrypt, isEncrypted } from "./encryption";
import { eq } from "drizzle-orm";

export async function migrateEncryptCredentials(): Promise<void> {
  try {
    const allStudies = await db.select().from(studies);
    let migrated = 0;

    for (const study of allStudies) {
      if (!study.movebankUsername || !study.movebankPassword) {
        continue;
      }

      const needsUsernameEncrypt = !isEncrypted(study.movebankUsername);
      const needsPasswordEncrypt = !isEncrypted(study.movebankPassword);

      if (needsUsernameEncrypt || needsPasswordEncrypt) {
        const updates: Record<string, string> = {};
        if (needsUsernameEncrypt) {
          updates.movebankUsername = encrypt(study.movebankUsername);
        }
        if (needsPasswordEncrypt) {
          updates.movebankPassword = encrypt(study.movebankPassword);
        }

        await db.update(studies).set(updates).where(eq(studies.id, study.id));
        migrated++;
      }
    }

    if (migrated > 0) {
      console.log(`[encryption] Migración completada: ${migrated} estudio(s) cifrado(s).`);
    } else {
      console.log("[encryption] Todas las credenciales ya están cifradas.");
    }
  } catch (err: any) {
    console.error(`[encryption] Error durante la migración de credenciales: ${err.message}`);
  }
}
