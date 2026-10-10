// services/core/logic/trading/schwab/schwabClient.js
// Engine 8 — Schwab OAuth and read-only API client.
//
// Phase 1 only:
// - exchange authorization code
// - refresh access token
// - read account-number/hash mappings
//
// This file does not place orders.

import fs from "node:fs";
import path from "node:path";
import {
  getSchwabConfig,
  validateSchwabPhase1Config,
} from "./schwabConfig.js";

import {
  readSchwabTokens,
  saveSchwabTokens,
} from "./schwabTokenStore.js";

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

function basicAuthorizationHeader(appKey, appSecret) {
  const credentials = Buffer.from(
    `${appKey}:${appSecret}`,
    "utf8"
  ).toString("base64");

  return `Basic ${credentials}`;
}

async function readResponseBody(response) {
  const rawText = await response.text();

  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return {
      rawText,
    };
  }
}

export function classifySchwabFailure(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.brokerCode || "").toLowerCase();
  if (code === "invalid_grant") return "SCHWAB_INVALID_GRANT";
  if (status === 429) return "SCHWAB_RATE_LIMITED";
  if (status === 401 || status === 403) return "SCHWAB_AUTHORIZATION_REJECTED";
  if (status >= 500 || !status) return "SCHWAB_TEMPORARY_FAILURE";
  return "SCHWAB_API_FAILURE";
}

function safeBrokerError({
  status,
  operation,
  body,
}) {
  const brokerMessage =
    body?.error || body?.code || null;

  const error = new Error(
    brokerMessage
      ? `${operation}: ${brokerMessage}`
      : `${operation}: HTTP_${status}`
  );

  error.status = status;
  error.operation = operation;
  error.brokerCode =
    body?.error || body?.code || null;
  error.reason = classifySchwabFailure(error);
  return error;
}

async function tokenRequest(parameters) {
  const validation = validateSchwabPhase1Config();

  if (!validation.ok) {
    const error = new Error(
      "SCHWAB_PHASE1_CONFIG_INVALID"
    );

    error.reasonCodes = validation.reasonCodes;
    throw error;
  }

  const config = validation.config;

  const response = await fetch(config.oauthTokenUrl, {
    method: "POST",
    headers: {
      Authorization: basicAuthorizationHeader(
        config.appKey,
        config.appSecret
      ),
      "Content-Type":
        "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(parameters).toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const body = await readResponseBody(response);

  if (!response.ok) {
    throw safeBrokerError({
      status: response.status,
      operation: "SCHWAB_TOKEN_REQUEST_FAILED",
      body,
    });
  }

  if (!body?.access_token) {
    throw new Error(
      "SCHWAB_TOKEN_RESPONSE_MISSING_ACCESS_TOKEN"
    );
  }

  return body;
}

// Single-host cross-process serialization: the HTTP server and fill watcher
// both access one persistent token file. Never rely on an in-memory mutex.
async function withTokenRefreshLock(callback) {
  const config = getSchwabConfig();
  const lockFile = config.tokenFile + ".refresh.lock";
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 40000;
  let owner = null;
  while (!owner) {
    try {
      const fd = fs.openSync(lockFile, "wx", 0o600);
      owner = String(process.pid) + ":" + Date.now();
      fs.writeFileSync(fd, owner);
      fs.closeSync(fd);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      // Stale locks are cleared only when their process is definitely gone.
      try {
        const value = fs.readFileSync(lockFile, "utf8");
        const pid = Number.parseInt(value.split(":")[0], 10);
        const age = Date.now() - fs.statSync(lockFile).mtimeMs;
        if (age > 60000 && Number.isSafeInteger(pid) && pid > 0) {
          let alive = true;
          try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") alive = false; }
          if (!alive) fs.unlinkSync(lockFile);
        }
      } catch (readError) {
        if (readError?.code !== "ENOENT") throw readError;
      }
      if (Date.now() >= deadline) throw new Error("SCHWAB_TOKEN_REFRESH_LOCK_TIMEOUT");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await callback(); }
  finally {
    try {
      if (fs.readFileSync(lockFile, "utf8") === owner) fs.unlinkSync(lockFile);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export async function exchangeSchwabAuthorizationCode(
  authorizationCode
) {
  const config = getSchwabConfig();
  const code = String(
    authorizationCode || ""
  ).trim();

  if (!code) {
    throw new Error(
      "MISSING_SCHWAB_AUTHORIZATION_CODE"
    );
  }

  const tokenResponse = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  return withTokenRefreshLock(() => saveSchwabTokens(tokenResponse, { authorization: true }));
}

export async function refreshSchwabAccessToken() {
  return withTokenRefreshLock(async () => {
    // Re-read after acquiring the cross-process lock. Another process may
    // already have refreshed the token while this caller was waiting.
    const currentTokens = readSchwabTokens();
    if (!currentTokens?.refresh_token) throw new Error("MISSING_SCHWAB_REFRESH_TOKEN");
    if (!accessTokenNeedsRefresh(currentTokens)) {
      return { ok: true, refreshed: false, reusedNewerToken: true };
    }
    const tokenResponse = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: currentTokens.refresh_token,
    });
    const mergedResponse = {
      ...tokenResponse,
      refresh_token: tokenResponse.refresh_token || currentTokens.refresh_token,
      refresh_token_expires_in:
        tokenResponse.refresh_token_expires_in ??
        currentTokens.refresh_token_expires_in ?? null,
    };
    saveSchwabTokens(mergedResponse, { authorization: false });
    return { ok: true, refreshed: true };
  });
}

function accessTokenNeedsRefresh(tokens) {
  if (!tokens?.access_token) {
    return true;
  }

  if (!tokens?.expires_at) {
    return false;
  }

  const expiresAtMs = Date.parse(tokens.expires_at);

  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  return (
    expiresAtMs - Date.now() <=
    ACCESS_TOKEN_REFRESH_BUFFER_MS
  );
}

export async function getValidSchwabAccessToken() {
  let tokens = readSchwabTokens();

  if (!tokens?.refresh_token) {
    throw new Error(
      "SCHWAB_NOT_AUTHORIZED"
    );
  }

  if (accessTokenNeedsRefresh(tokens)) {
    await refreshSchwabAccessToken();
    tokens = readSchwabTokens();
  }

  if (!tokens?.access_token) {
    throw new Error(
      "MISSING_SCHWAB_ACCESS_TOKEN_AFTER_REFRESH"
    );
  }

  return tokens.access_token;
}

export async function schwabApiRequest(
  endpointPath,
  options = {}
) {
  const config = getSchwabConfig();
  const accessToken =
    await getValidSchwabAccessToken();

  const normalizedPath = String(
    endpointPath || ""
  ).startsWith("/")
    ? String(endpointPath)
    : `/${String(endpointPath || "")}`;

  const url =
    `${config.traderApiBaseUrl}${normalizedPath}`;

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
    signal:
      options.signal ||
      AbortSignal.timeout(20_000),
  });

  const body = await readResponseBody(response);

  if (!response.ok) {
    throw safeBrokerError({
      status: response.status,
      operation:
        options.operation ||
        "SCHWAB_API_REQUEST_FAILED",
      body,
    });
  }

  return {
    ok: true,
    status: response.status,
    body,
  };
}

function maskAccountNumber(accountNumber) {
  const normalized = String(
    accountNumber || ""
  ).trim();

  if (!normalized) {
    return null;
  }

  const visible = normalized.slice(-4);

  return `****${visible}`;
}

export async function getSchwabAccountNumbers() {
  const response = await schwabApiRequest(
    "/accounts/accountNumbers",
    {
      operation:
        "SCHWAB_ACCOUNT_NUMBERS_REQUEST_FAILED",
    }
  );

  const rawAccounts = Array.isArray(response.body)
    ? response.body
    : [];

  const accounts = rawAccounts.map(
    (account, index) => ({
      index,
      maskedAccountNumber: maskAccountNumber(
        account?.accountNumber
      ),
      hasAccountHash: Boolean(
        account?.hashValue
      ),

      // Kept internally for later manual selection.
      // Routes must never return this raw value.
      accountHash:
        String(account?.hashValue || "").trim() ||
        null,
    })
  );

  return {
    ok: true,
    broker: "SCHWAB",
    accountCount: accounts.length,
    accounts,
  };
}

export default {
  exchangeSchwabAuthorizationCode,
  refreshSchwabAccessToken,
  getValidSchwabAccessToken,
  schwabApiRequest,
  getSchwabAccountNumbers,
};
