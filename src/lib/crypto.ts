// AES-256-GCM envelope encryption for stored credentials.
//
// Format on disk: base64(iv):base64(authTag):base64(ciphertext)
// Key: 32 bytes (64 hex chars) from CRED_ENCRYPTION_KEY env var.
//
// Rotating CRED_ENCRYPTION_KEY invalidates every stored credential — users
// must re-enter passwords. Losing the key = same effect. Back it up.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const hex = process.env.CRED_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "CRED_ENCRYPTION_KEY must be a 64-hex-char string (32 bytes). Generate with `openssl rand -hex 32`.",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
