cd /opt/render/project/src

mkdir -p services/core/logic/trading/schwab

cat > services/core/logic/trading/schwab/schwabConfig.js <<'EOF'
// services/core/logic/trading/schwab/schwabConfig.js
// Engine 8 — Schwab configuration
//
// Phase 1 only:
// - readiness
// - OAuth
// - encrypted token storage
// - read-only account discovery
//
// This file does not place orders.

import path from "path";

const DEFAULT_PRIVATE_DATA_DIR = "/var/data/replay/engine8-private";

function envText(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function envBool(name, fallback = false) {
  const raw = envText(name);

  if (!raw) return fallback;

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function envPositiveInt(name, fallback) {
  const parsed = Number.parseInt(envText(name), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeDirectory(value) {
  const selected = String(value || DEFAULT_PRIVATE_DATA_DIR).trim();

  return path.resolve(selected || DEFAULT_PRIVATE_DATA_DIR);
}

function validateRedirectUri(value) {
  if (!value) {
    return {
      valid: false,
      protocol: null,
      pathname: null,
      reason: "MISSING_SCHWAB_REDIRECT_URI",
    };
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") {
      return {
        valid: false,
        protocol: parsed.protocol,
        pathname: parsed.pathname,
        reason: "SCHWAB_REDIRECT_URI_MUST_USE_HTTPS",
      };
    }

    return {
      valid: true,
      protocol: parsed.protocol,
      pathname: parsed.pathname,
      reason: null,
    };
  } catch {
    return {
      valid: false,
      protocol: null,
      pathname: null,
      reason: "INVALID_SCHWAB_REDIRECT_URI",
    };
  }
}

export function getSchwabConfig() {
  const appKey = envText("SCHWAB_APP_KEY");
  const appSecret = envText("SCHWAB_APP_SECRET");
  const redirectUri = envText("SCHWAB_REDIRECT_URI");

  const adminSecret = envText("ENGINE8_ADMIN_SECRET");
  const tokenEncryptionKey = envText("SCHWAB_TOKEN_ENCRYPTION_KEY");

  const privateDataDir = normalizeDirectory(
    envText("SCHWAB_PRIVATE_DATA_DIR", DEFAULT_PRIVATE_DATA_DIR)
  );

  const redirectValidation = validateRedirectUri(redirectUri);

  return {
    broker: "SCHWAB",

    // Schwab OAuth/API configuration
    appKey,
    appSecret,
    redirectUri,

    oauthAuthorizeUrl:
      envText(
        "SCHWAB_OAUTH_AUTHORIZE_URL",
        "https://api.schwabapi.com/v1/oauth/authorize"
      ),

    oauthTokenUrl:
      envText(
        "SCHWAB_OAUTH_TOKEN_URL",
        "https://api.schwabapi.com/v1/oauth/token"
      ),

    traderApiBaseUrl:
      envText(
        "SCHWAB_TRADER_API_BASE_URL",
        "https://api.schwabapi.com/trader/v1"
      ),

    // Engine 8 protection
    adminSecret,
    tokenEncryptionKey,
    privateDataDir,

    tokenFile: path.resolve(privateDataDir, "schwab-token.enc.json"),
    oauthStateFile: path.resolve(privateDataDir, "schwab-oauth-state.json"),
    accountSelectionFile: path.resolve(
      privateDataDir,
      "schwab-account-selection.enc.json"
    ),

    // OAuth state expires quickly and may be used only once.
    oauthStateTtlSeconds: envPositiveInt(
      "SCHWAB_OAUTH_STATE_TTL_SECONDS",
      600
    ),

    // Safety flags remain disabled by default.
    liveTradingEnabled: envBool("ENGINE8_LIVE_TRADING_ENABLED", false),
    allowLiveFutures: envBool("ENGINE8_ALLOW_LIVE_FUTURES", false),
    requireConfirmBeforeSend: envBool(
      "ENGINE8_REQUIRE_CONFIRM_BEFORE_SEND",
      true
    ),

    maxLiveMesContracts: envPositiveInt(
      "ENGINE8_MAX_LIVE_MES_CONTRACTS",
      1
    ),

    maxLiveRiskDollars: envPositiveInt(
      "ENGINE8_MAX_LIVE_RISK_DOLLARS",
      50
    ),

    runtimeKillSwitch: envBool("ENGINE8_LIVE_KILL_SWITCH", true),

    redirectValidation,
  };
}

/**
 * Returns safe configuration information.
 *
 * Never return actual:
 * - app key
 * - app secret
 * - admin secret
 * - encryption key
 * - tokens
 * - account hashes
 */
export function getSafeSchwabConfigSummary() {
  const config = getSchwabConfig();

  return {
    broker: config.broker,

    hasAppKey: Boolean(config.appKey),
    hasAppSecret: Boolean(config.appSecret),
    hasRedirectUri: Boolean(config.redirectUri),
    redirectUriValid: config.redirectValidation.valid,
    redirectPath: config.redirectValidation.pathname,
    redirectValidationReason: config.redirectValidation.reason,

    hasAdminSecret: Boolean(config.adminSecret),
    hasTokenEncryptionKey: Boolean(config.tokenEncryptionKey),
    hasPrivateDataDir: Boolean(config.privateDataDir),

    liveTradingEnabled: config.liveTradingEnabled,
    allowLiveFutures: config.allowLiveFutures,
    requireConfirmBeforeSend: config.requireConfirmBeforeSend,
    runtimeKillSwitch: config.runtimeKillSwitch,

    maxLiveMesContracts: config.maxLiveMesContracts,
    maxLiveRiskDollars: config.maxLiveRiskDollars,
  };
}

export function validateSchwabPhase1Config() {
  const config = getSchwabConfig();
  const reasonCodes = [];

  if (!config.appKey) {
    reasonCodes.push("MISSING_SCHWAB_APP_KEY");
  }

  if (!config.appSecret) {
    reasonCodes.push("MISSING_SCHWAB_APP_SECRET");
  }

  if (!config.redirectUri) {
    reasonCodes.push("MISSING_SCHWAB_REDIRECT_URI");
  } else if (!config.redirectValidation.valid) {
    reasonCodes.push(
      config.redirectValidation.reason || "INVALID_SCHWAB_REDIRECT_URI"
    );
  }

  if (!config.adminSecret) {
    reasonCodes.push("MISSING_ENGINE8_ADMIN_SECRET");
  }

  if (!config.tokenEncryptionKey) {
    reasonCodes.push("MISSING_SCHWAB_TOKEN_ENCRYPTION_KEY");
  }

  if (!config.privateDataDir) {
    reasonCodes.push("MISSING_SCHWAB_PRIVATE_DATA_DIR");
  }

  return {
    ok: reasonCodes.length === 0,
    reasonCodes,
    config,
  };
}

export default getSchwabConfig;
