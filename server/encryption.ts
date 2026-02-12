import crypto from "crypto";

let encryptionKey: Buffer;

function isValidHexKey(key: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(key);
}

export function initEncryption(): void {
  const envKey = process.env.ENCRYPTION_KEY;

  if (envKey && isValidHexKey(envKey)) {
    encryptionKey = Buffer.from(envKey, "hex");
    console.log("[encryption] ENCRYPTION_KEY cargada correctamente desde variable de entorno.");
  } else {
    const generated = crypto.randomBytes(32);
    encryptionKey = generated;
    const hexKey = generated.toString("hex");
    console.warn("═══════════════════════════════════════════════════════════════════");
    console.warn("  ADVERTENCIA: No se encontró ENCRYPTION_KEY válida.");
    console.warn("  Se generó una clave temporal. Los datos cifrados se perderán si");
    console.warn("  el servidor se reinicia sin guardar esta clave.");
    console.warn("");
    console.warn(`  ENCRYPTION_KEY=${hexKey}`);
    console.warn("");
    console.warn("  Guárdala como variable de entorno para mantener el cifrado.");
    console.warn("═══════════════════════════════════════════════════════════════════");
  }
}

export function encrypt(plaintext: string): string {
  if (!encryptionKey) {
    throw new Error("Encryption not initialized. Call initEncryption() first.");
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  if (!encryptionKey) {
    throw new Error("Encryption not initialized. Call initEncryption() first.");
  }

  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Formato de texto cifrado inválido. Se esperaba iv:authTag:ciphertext");
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err: any) {
    throw new Error(
      `Error al descifrar: la clave de cifrado puede haber cambiado. Detalle: ${err.message}`
    );
  }
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  return parts.every((p) => /^[0-9a-fA-F]+$/.test(p));
}
