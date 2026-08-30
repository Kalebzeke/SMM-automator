import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.TELEGRAM_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Missing TELEGRAM_TOKEN_ENCRYPTION_KEY environment variable."
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TELEGRAM_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded)."
    );
  }

  return key;
}

// Encrypted form: base64(iv[12] || authTag[16] || ciphertext).
export function encryptToken(plainText: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptToken(encrypted: string): string {
  const key = getKey();
  const buffer = Buffer.from(encrypted, "base64");

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buffer.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

// Last 4 characters only — safe to show in the UI so an admin can recognize
// which bot is configured without ever reconstructing the full token.
export function tokenPreview(plainText: string): string {
  const trimmed = plainText.trim();
  return trimmed.length > 4 ? `••••${trimmed.slice(-4)}` : "••••";
}
