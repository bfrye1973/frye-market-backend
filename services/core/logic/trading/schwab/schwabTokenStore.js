// services/core/logic/trading/schwab/schwabTokenStore.js
// Engine 8 — encrypted Schwab token persistence.
//
// Stores encrypted OAuth tokens on the configured persistent disk.
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
  const directory = config.privateDataDir;

  if (!directory) {
    throw new Error("SCHWAB_PRIVATE_DATA_DIR_NOT_CONFIGURED");
  }

  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700,
  });

  fs.chmodSync(directory, 0o700);

  const stat = fs.statSync(directory);

  if (!stat.isDirectory()) {
    throw new Error("SCHWAB_PRIVATE_DATA_PATH_IS_NOT_DIRECTORY");
  }

  return directory;
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

  const authTag = cipher.getAuthTag();

  return {
    version: ENCRYPTION_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    writtenAt: nowIso(),
  };
}

function decryptJson(envelope, encryptionSecret) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("INVALID_SCHWAB_TOKEN_ENVELOPE");
  }

  if (Number(envelope.version) !== ENCRYPTION_VERSION) {
    throw new Error("UNSUPPORTED_SCHWAB_TOKEN_ENCRYPTION_VERSION");
  }

  if (envelope.algorithm !== ALGORITHM) {
    throw new Error("UNSUPPORTED_SCHWAB_TOKEN_ENCRYPTION_ALGORITHM");
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
    throw new Error("INVALID_SCHWAB_TOKEN_IV");
  }

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("INVALID_SCHWAB_TOKEN_AUTH_TAG");
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

function normalizeTokenRecord(tokens = {}) {
  const accessToken = String(tokens.access_token || "").trim();
  const refreshToken = String(tokens.refresh_token || "").trim();
  const tokenType = String(tokens.token_type || "Bearer").trim();
  const scope = String(tokens.scope || "").trim();

  const expiresInSeconds = Number(tokens.expires_in);
  const refreshExpiresInSeconds = Number(
    tokens.refresh_token_expires_in ??
      tokens.refresh_expires_in
  );

  const issuedAtMs = Date.now();

  const expiresAt =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? new Date(
          issuedAtMs + expiresInSeconds * 1000
        ).toISOString()
      : null;

  const refreshExpiresAt =
    Number.isFinite(refreshExpiresInSeconds) &&
    refreshExpiresInSeconds > 0
      ? new Date(
          issuedAtMs + refreshExpiresInSeconds * 1000
        ).toISOString()
      : null;

  if (!accessToken) {
    throw new Error("MISSING_SCHWAB_ACCESS_TOKEN");
  }

  if (!refreshToken) {
    throw new Error("MISSING_SCHWAB_REFRESH_TOKEN");
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: tokenType || "Bearer",
    scope: scope || null,
    expires_in:
      Number.isFinite(expiresInSeconds) &&
      expiresInSeconds > 0
        ? expiresInSeconds
        : null,
    refresh_token_expires_in:
      Number.isFinite(refreshExpiresInSeconds) &&
      refreshExpiresInSeconds > 0
        ? refreshExpiresInSeconds
        : null,
    issued_at: nowIso(),
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
  };
}

export function tokenFileExists() {
  const config = getSchwabConfig();

  return Boolean(
    config.tokenFile && fs.existsSync(config.tokenFile)
  );
}

export function saveSchwabTokens(tokens) {
  const config = getSchwabConfig();

  if (!config.tokenEncryptionKey) {
    throw new Error("SCHWAB_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  }

  ensurePrivateDirectory(config);

  const normalizedTokens = normalizeTokenRecord(tokens);
  const encryptedEnvelope = encryptJson(
    normalizedTokens,
    config.tokenEncryptionKey
  );

  writeJsonAtomic(config.tokenFile, encryptedEnvelope);

  return {
    ok: true,
    saved: true,
    hasAccessToken: true,
    hasRefreshToken: true,
    expiresAt: normalizedTokens.expires_at,
    refreshExpiresAt: normalizedTokens.refresh_expires_at,
    tokenFileConfigured: true,
  };
}

export function readSchwabTokens() {
  const config = getSchwabConfig();

  if (!config.tokenEncryptionKey) {
    throw new Error("SCHWAB_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  }

  if (!config.tokenFile || !fs.existsSync(config.tokenFile)) {
    return null;
  }

  const encryptedEnvelope = JSON.parse(
    fs.readFileSync(config.tokenFile, "utf8")
  );

  return decryptJson(
    encryptedEnvelope,
    config.tokenEncryptionKey
  );
}

export function deleteSchwabTokens() {
  const config = getSchwabConfig();

  if (!config.tokenFile || !fs.existsSync(config.tokenFile)) {
    return {
      ok: true,
      deleted: false,
      reason: "SCHWAB_TOKEN_FILE_NOT_FOUND",
    };
  }

  fs.unlinkSync(config.tokenFile);

  return {
    ok: true,
    deleted: true,
  };
}

export function getSafeTokenStatus() {
  const config = getSchwabConfig();

  const status = {
    tokenFileConfigured: Boolean(config.tokenFile),
    tokenFileExists: false,
    tokenReadable: false,
    hasAccessToken: false,
    hasRefreshToken: false,
    accessTokenExpired: null,
    refreshTokenExpired: null,
    expiresAt: null,
    refreshExpiresAt: null,
    error: null,
  };

  if (!config.tokenFile) {
    status.error = "SCHWAB_TOKEN_FILE_NOT_CONFIGURED";
    return status;
  }

  status.tokenFileExists = fs.existsSync(config.tokenFile);

  if (!status.tokenFileExists) {
    return status;
  }

  try {
    const tokens = readSchwabTokens();

    status.tokenReadable = Boolean(tokens);
    status.hasAccessToken = Boolean(tokens?.access_token);
    status.hasRefreshToken = Boolean(tokens?.refresh_token);
    status.expiresAt = tokens?.expires_at || null;
    status.refreshExpiresAt =
      tokens?.refresh_expires_at || null;

    status.accessTokenExpired = tokens?.expires_at
      ? Date.parse(tokens.expires_at) <= Date.now()
      : null;

    status.refreshTokenExpired = tokens?.refresh_expires_at
      ? Date.parse(tokens.refresh_expires_at) <= Date.now()
      : null;
  } catch (error) {
    status.error = String(
      error?.message || "SCHWAB_TOKEN_READ_FAILED"
    );
  }

  return status;
}

export default {
  tokenFileExists,
  saveSchwabTokens,
  readSchwabTokens,
  deleteSchwabTokens,
  getSafeTokenStatus,
};
