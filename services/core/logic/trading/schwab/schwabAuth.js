// services/core/logic/trading/schwab/schwabAuth.js
// Engine 8 — Schwab OAuth helpers.
//
// Phase 1 only:
// - create OAuth login URL
// - persist short-lived, single-use OAuth state
// - validate callback state
//
// This file does not place orders.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getSchwabConfig } from "./schwabConfig.js";

function nowIso() {
  return new Date().toISOString();
}

function ensurePrivateDirectory(config) {
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
      // Best-effort cleanup.
    }
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSchwabOAuthState() {
  const config = getSchwabConfig();

  if (!config.privateDataDir || !config.oauthStateFile) {
    throw new Error("SCHWAB_OAUTH_STATE_STORAGE_NOT_CONFIGURED");
  }

  ensurePrivateDirectory(config);

  const state = crypto.randomBytes(32).toString("hex");
  const createdAtMs = Date.now();
  const expiresAtMs =
    createdAtMs + config.oauthStateTtlSeconds * 1000;

  const record = {
    state,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    used: false,
  };

  writeJsonAtomic(config.oauthStateFile, record);

  return {
    state,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function validateAndConsumeSchwabOAuthState(
  suppliedState
) {
  const config = getSchwabConfig();
  const normalizedState = String(suppliedState || "").trim();

  if (!normalizedState) {
    return {
      ok: false,
      reason: "MISSING_SCHWAB_OAUTH_STATE",
    };
  }

  if (
    !config.oauthStateFile ||
    !fs.existsSync(config.oauthStateFile)
  ) {
    return {
      ok: false,
      reason: "SCHWAB_OAUTH_STATE_NOT_FOUND",
    };
  }

  let record;

  try {
    record = JSON.parse(
      fs.readFileSync(config.oauthStateFile, "utf8")
    );
  } catch {
    return {
      ok: false,
      reason: "SCHWAB_OAUTH_STATE_UNREADABLE",
    };
  }

  if (record?.used === true) {
    return {
      ok: false,
      reason: "SCHWAB_OAUTH_STATE_ALREADY_USED",
    };
  }

  const expiresAtMs = Date.parse(record?.expiresAt || "");

  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now()
  ) {
    return {
      ok: false,
      reason: "SCHWAB_OAUTH_STATE_EXPIRED",
    };
  }

  if (!safeEqual(normalizedState, record?.state)) {
    return {
      ok: false,
      reason: "SCHWAB_OAUTH_STATE_MISMATCH",
    };
  }

  const consumedRecord = {
    ...record,
    used: true,
    usedAt: nowIso(),
  };

  writeJsonAtomic(
    config.oauthStateFile,
    consumedRecord
  );

  return {
    ok: true,
    consumed: true,
    createdAt: record.createdAt || null,
    expiresAt: record.expiresAt || null,
    usedAt: consumedRecord.usedAt,
  };
}

export function buildSchwabLoginUrl() {
  const config = getSchwabConfig();

  if (!config.appKey) {
    throw new Error("MISSING_SCHWAB_APP_KEY");
  }

  if (!config.redirectUri) {
    throw new Error("MISSING_SCHWAB_REDIRECT_URI");
  }

  if (!config.redirectValidation?.valid) {
    throw new Error(
      config.redirectValidation?.reason ||
        "INVALID_SCHWAB_REDIRECT_URI"
    );
  }

  const oauthState = createSchwabOAuthState();

  const loginUrl = new URL(config.oauthAuthorizeUrl);

  loginUrl.searchParams.set(
    "client_id",
    config.appKey
  );

  loginUrl.searchParams.set(
    "redirect_uri",
    config.redirectUri
  );

  loginUrl.searchParams.set(
    "response_type",
    "code"
  );

  loginUrl.searchParams.set(
    "state",
    oauthState.state
  );

  return {
    ok: true,
    broker: "SCHWAB",
    loginUrl: loginUrl.toString(),
    stateExpiresAt: oauthState.expiresAt,
    liveOrderEnabled: false,
    willPlaceOrder: false,
  };
}

export default {
  createSchwabOAuthState,
  validateAndConsumeSchwabOAuthState,
  buildSchwabLoginUrl,
};
