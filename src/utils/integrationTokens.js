import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "./AppError.js";

function encryptionKey() {
  const value = env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new AppError(
      "INTEGRATION_TOKEN_ENCRYPTION_KEY must be a 32-byte hex value.",
      503,
      "INTEGRATION_ENCRYPTION_NOT_CONFIGURED",
    );
  }
  return Buffer.from(value, "hex");
}

export function assertIntegrationEncryptionConfigured() {
  encryptionKey();
}

export function encryptIntegrationToken(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptIntegrationToken(value) {
  if (!value) return "";
  const [version, ivHex, tagHex, encryptedHex] = String(value).split(".");
  if (version !== "v1" || !ivHex || !tagHex || !encryptedHex) {
    throw new AppError("Stored integration token has an invalid format.", 500, "INVALID_ENCRYPTED_TOKEN");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
