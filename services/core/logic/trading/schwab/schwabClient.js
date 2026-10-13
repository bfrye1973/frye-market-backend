// services/core/logic/trading/schwab/schwabClient.js
// Engine 8 — Schwab OAuth and read-only API client.
//
// Phase 1 only:
// - exchange authorization code
// - refresh access token
// - read account-number/hash mappings
//
// This file does not place orders.

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

function safeBrokerError({
  status,
  operation,
  body,
}) {
  const brokerMessage =
    body?.message ||
    body?.error_description ||
    body?.error ||
    null;

  const error = new Error(
    brokerMessage
      ? `${operation}: ${brokerMessage}`
      : `${operation}: HTTP_${status}`
  );

  error.status = status;
  error.operation = operation;
  error.brokerCode =
    body?.error ||
    body?.code ||
    null;

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

  return saveSchwabTokens(tokenResponse);
}

export async function refreshSchwabAccessToken() {
  const currentTokens = readSchwabTokens();

  if (!currentTokens?.refresh_token) {
    throw new Error(
      "MISSING_SCHWAB_REFRESH_TOKEN"
    );
  }

  const tokenResponse = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: currentTokens.refresh_token,
  });

  // Some OAuth providers omit a replacement refresh token.
  // Preserve the current refresh token in that case.
  const mergedResponse = {
    ...tokenResponse,
    refresh_token:
      tokenResponse.refresh_token ||
      currentTokens.refresh_token,
    refresh_token_expires_in:
      tokenResponse.refresh_token_expires_in ??
      currentTokens.refresh_token_expires_in ??
      null,
  };

  saveSchwabTokens(mergedResponse);

  return {
    ok: true,
    refreshed: true,
  };
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
