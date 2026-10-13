// services/core/logic/trading/schwab/schwabAccountStore.js
// Engine 8 — encrypted Schwab account selection storage.
//
// Stores only the selected account hash and masked label.
// This file does not place orders.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getSchwabConfig } from "./schwabConfig.js";

const ENCRYPTION_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function nowIso() {
  return new Date().toISOString();
}

function deriveEncryptionKey(secret) {
  const normalized = String(secret || "").trim();

  if (!normalized) {
    throw new Error("SCHWAB_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  }

  return crypto.createHash("sha256").update(normalized, "utf8").digest();
}

function ensurePrivateDirectory(config) {
  if (!config.privateDataDir) {
    throw new Error("SCHWAB_PRIVATE_DATA_DIR_NOT_CONFIGURED");
  }

  fs.mkdirSync(config.privateDataDir, {
    recursive: true,
    mode: 0o700,
  });

  fs.chmodSync(config.privateDataDir, 0o700);
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700,
  });

  try {
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(value, null, 2),
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "w",
      }
    );

    fs.chmodSync(temporaryFile, 0o600);
    fs.renameSync(temporaryFile, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try {
      if (fs.existsSync(temporaryFile)) {
        fs.unlinkSync(temporaryFile);
      }
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function encryptJson(value, encryptionSecret) {
  const key = deriveEncryptionKey(encryptionSecret);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const plaintext = Buffer.from(JSON.stringify(value), "utf8");

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  return {
    version: ENCRYPTION_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    writtenAt: nowIso(),
  };
}

function decryptJson(envelope, encryptionSecret) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("INVALID_SCHWAB_ACCOUNT_ENVELOPE");
  }

  if (Number(envelope.version) !== ENCRYPTION_VERSION) {
    throw new Error("UNSUPPORTED_SCHWAB_ACCOUNT_ENCRYPTION_VERSION");
  }

  if (envelope.algorithm !== ALGORITHM) {
    throw new Error("UNSUPPORTED_SCHWAB_ACCOUNT_ENCRYPTION_ALGORITHM");
  }

  const key = deriveEncryptionKey(encryptionSecret);
  const iv = Buffer.from(String(envelope.iv || ""), "base64");
  const authTag = Buffer.from(
    String(envelope.authTag || ""),
    "base64"
  );
  const ciphertext = Buffer.from(
    String(envelope.ciphertext || ""),
    "base64"
  );

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error("INVALID_SCHWAB_ACCOUNT_IV");
  }

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("INVALID_SCHWAB_ACCOUNT_AUTH_TAG");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}

export function saveSelectedSchwabAccount({
  accountHash,
  maskedAccountNumber,
  selectedBy = "BRIAN",
}) {
  const config = getSchwabConfig();

  const normalizedHash = String(accountHash || "").trim();
  const normalizedMasked = String(maskedAccountNumber || "").trim();

  if (!normalizedHash) {
    throw new Error("MISSING_SCHWAB_ACCOUNT_HASH");
  }

  if (!normalizedMasked) {
    throw new Error("MISSING_MASKED_ACCOUNT_NUMBER");
  }

  if (!config.tokenEncryptionKey) {
    throw new Error("SCHWAB_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  }

  ensurePrivateDirectory(config);

  const record = {
    accountHash: normalizedHash,
    maskedAccountNumber: normalizedMasked,
    selectedBy: String(selectedBy || "BRIAN"),
    selectedAt: nowIso(),
  };

  const encryptedEnvelope = encryptJson(
    record,
    config.tokenEncryptionKey
  );

  writeJsonAtomic(
    config.accountSelectionFile,
    encryptedEnvelope
  );

  return {
    ok: true,
    saved: true,
    maskedAccountNumber: record.maskedAccountNumber,
    selectedAt: record.selectedAt,
  };
}

export function readSelectedSchwabAccount() {
  const config = getSchwabConfig();

  if (
    !config.accountSelectionFile ||
    !fs.existsSync(config.accountSelectionFile)
  ) {
    return null;
  }

  if (!config.tokenEncryptionKey) {
    throw new Error("SCHWAB_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  }

  const encryptedEnvelope = JSON.parse(
    fs.readFileSync(config.accountSelectionFile, "utf8")
  );

  return decryptJson(
    encryptedEnvelope,
    config.tokenEncryptionKey
  );
}

export function deleteSelectedSchwabAccount() {
  const config = getSchwabConfig();

  if (
    !config.accountSelectionFile ||
    !fs.existsSync(config.accountSelectionFile)
  ) {
    return {
      ok: true,
      deleted: false,
      reason: "SCHWAB_ACCOUNT_SELECTION_NOT_FOUND",
    };
  }

  fs.unlinkSync(config.accountSelectionFile);

  return {
    ok: true,
    deleted: true,
  };
}

export function getSafeSelectedSchwabAccountStatus() {
  const status = {
    selectedAccountPresent: false,
    maskedAccountNumber: null,
    selectedAt: null,
    readable: false,
    error: null,
  };

  try {
    const record = readSelectedSchwabAccount();

    if (!record) {
      return status;
    }

    status.selectedAccountPresent = Boolean(record.accountHash);
    status.maskedAccountNumber =
      record.maskedAccountNumber || null;
    status.selectedAt = record.selectedAt || null;
    status.readable = true;
  } catch (error) {
    status.error = String(
      error?.message || "SCHWAB_ACCOUNT_SELECTION_READ_FAILED"
    );
  }

  return status;
}

export default {
  saveSelectedSchwabAccount,
  readSelectedSchwabAccount,
  deleteSelectedSchwabAccount,
  getSafeSelectedSchwabAccountStatus,
};
