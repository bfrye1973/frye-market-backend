// services/core/routes/schwabAuth.js
// Engine 8 — Schwab readiness, OAuth, account discovery,
// and manual account selection routes.
//
// Phase 1 only.
// No order-building or order-placement routes exist here.

import express from "express";

import { requireEngine8Admin } from "../logic/trading/schwab/engine8AdminAuth.js";

import {
  getSafeSchwabConfigSummary,
  validateSchwabPhase1Config,
} from "../logic/trading/schwab/schwabConfig.js";

import {
  getSafeTokenStatus,
} from "../logic/trading/schwab/schwabTokenStore.js";

import {
  buildSchwabLoginUrl,
  validateAndConsumeSchwabOAuthState,
} from "../logic/trading/schwab/schwabAuth.js";

import {
  exchangeSchwabAuthorizationCode,
  getSchwabAccountNumbers,
} from "../logic/trading/schwab/schwabClient.js";

import {
  getSafeSelectedSchwabAccountStatus,
} from "../logic/trading/schwab/schwabAccountStore.js";

import {
  selectSchwabAccountByIndex,
} from "../logic/trading/schwab/schwabAccountSelection.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function safeErrorMessage(error) {
  const message = String(
    error?.message || "SCHWAB_UNKNOWN_ERROR"
  );

  // Do not return authorization codes, tokens, secrets,
  // account hashes, request headers, or full broker responses.
  return message.slice(0, 500);
}

function htmlPage({
  title,
  heading,
  message,
  success = false,
}) {
  const safeTitle = String(title || "Schwab");
  const safeHeading = String(heading || "");
  const safeMessage = String(message || "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />
  <title>${safeTitle}</title>
</head>
<body style="font-family: Arial, sans-serif; padding: 32px;">
  <h1>${safeHeading}</h1>
  <p>${safeMessage}</p>
  <p>
    Status:
    <strong>${success ? "SUCCESS" : "FAILED"}</strong>
  </p>
  <p>You may close this browser window.</p>
</body>
</html>`;
}

/**
 * GET /api/auth/schwab/readiness
 *
 * Public-safe readiness response.
 * Never returns secrets, tokens, account numbers, or account hashes.
 */
router.get("/readiness", async (_req, res) => {
  try {
    const configSummary = getSafeSchwabConfigSummary();
    const validation = validateSchwabPhase1Config();
    const tokenStatus = getSafeTokenStatus();
    const selectedAccountStatus =
      getSafeSelectedSchwabAccountStatus();

    const hasRefreshToken =
      tokenStatus.hasRefreshToken === true &&
      tokenStatus.refreshTokenExpired !== true;

    const hasAccountHash =
      selectedAccountStatus.selectedAccountPresent === true;

    const canReadAccounts =
      validation.ok &&
      hasRefreshToken;

    // Phase 1 never places orders.
    const canPlaceOrders = false;

    return res.json({
      ok: true,
      broker: "SCHWAB",
      phase: "READINESS_AND_AUTH",

      hasAppKey: configSummary.hasAppKey,
      hasAppSecret: configSummary.hasAppSecret,
      hasRedirectUri: configSummary.hasRedirectUri,
      redirectUriValid:
        configSummary.redirectUriValid,
      redirectPath:
        configSummary.redirectPath,

      hasAdminSecret:
        configSummary.hasAdminSecret,
      hasTokenEncryptionKey:
        configSummary.hasTokenEncryptionKey,
      hasPrivateDataDir:
        configSummary.hasPrivateDataDir,

      tokenFileExists:
        tokenStatus.tokenFileExists,
      tokenReadable:
        tokenStatus.tokenReadable,
      hasAccessToken:
        tokenStatus.hasAccessToken,
      hasRefreshToken,
      accessTokenExpired:
        tokenStatus.accessTokenExpired,
      refreshTokenExpired:
        tokenStatus.refreshTokenExpired,
      tokenExpiresAt:
        tokenStatus.expiresAt,
      refreshTokenExpiresAt:
        tokenStatus.refreshExpiresAt,

      hasAccountHash,

      selectedAccountPresent:
        selectedAccountStatus.selectedAccountPresent,
      selectedMaskedAccountNumber:
        selectedAccountStatus.maskedAccountNumber,
      selectedAccountReadable:
        selectedAccountStatus.readable,
      selectedAccountError:
        selectedAccountStatus.error,

      canReadAccounts,

      liveTradingEnabled:
        configSummary.liveTradingEnabled,
      allowLiveFutures:
        configSummary.allowLiveFutures,
      requireConfirmBeforeSend:
        configSummary.requireConfirmBeforeSend,
      runtimeKillSwitch:
        configSummary.runtimeKillSwitch,

      canPlaceOrders,
      willPlaceOrder: false,

      phase1ConfigValid:
        validation.ok,
      reasonCodes:
        validation.reasonCodes,

      tokenStatusError:
        tokenStatus.error || null,

      ts: nowIso(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason: "SCHWAB_READINESS_FAILED",
      reasonCodes: [
        "SCHWAB_READINESS_FAILED",
      ],
      message: safeErrorMessage(error),
      canPlaceOrders: false,
      willPlaceOrder: false,
    });
  }
});

/**
 * GET /api/auth/schwab/login-url
 *
 * Requires:
 * X-Engine8-Admin-Secret
 */
router.get(
  "/login-url",
  requireEngine8Admin,
  async (_req, res) => {
    try {
      const validation =
        validateSchwabPhase1Config();

      if (!validation.ok) {
        return res.status(503).json({
          ok: false,
          rejected: true,
          reason:
            "SCHWAB_PHASE1_CONFIG_INVALID",
          reasonCodes:
            validation.reasonCodes,
          willPlaceOrder: false,
        });
      }

      const result =
        buildSchwabLoginUrl();

      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "SCHWAB_LOGIN_URL_FAILED",
        reasonCodes: [
          "SCHWAB_LOGIN_URL_FAILED",
        ],
        message: safeErrorMessage(error),
        willPlaceOrder: false,
      });
    }
  }
);

/**
 * GET /api/auth/schwab/callback
 *
 * Called by Schwab.
 * Does not require the admin header because Schwab cannot send it.
 * Requires the short-lived, single-use OAuth state.
 */
router.get("/callback", async (req, res) => {
  const brokerError = String(
    req.query?.error || ""
  ).trim();

  if (brokerError) {
    return res
      .status(400)
      .type("html")
      .send(
        htmlPage({
          title: "Schwab Authorization Failed",
          heading: "Schwab authorization failed",
          message:
            "Schwab returned an authorization error. No order was placed.",
          success: false,
        })
      );
  }

  const code = String(
    req.query?.code || ""
  ).trim();

  const state = String(
    req.query?.state || ""
  ).trim();

  if (!code) {
    return res
      .status(400)
      .type("html")
      .send(
        htmlPage({
          title: "Schwab Authorization Failed",
          heading: "Missing authorization code",
          message:
            "The callback did not include an authorization code.",
          success: false,
        })
      );
  }

  const stateResult =
    validateAndConsumeSchwabOAuthState(state);

  if (!stateResult.ok) {
    return res
      .status(400)
      .type("html")
      .send(
        htmlPage({
          title: "Schwab Authorization Failed",
          heading: "Invalid OAuth state",
          message:
            "The authorization state was missing, expired, already used, or did not match.",
          success: false,
        })
      );
  }

  try {
    const tokenResult =
      await exchangeSchwabAuthorizationCode(code);

    if (!tokenResult?.saved) {
      throw new Error(
        "SCHWAB_TOKEN_NOT_SAVED"
      );
    }

    return res
      .status(200)
      .type("html")
      .send(
        htmlPage({
          title: "Schwab Connected",
          heading:
            "Schwab authorization completed",
          message:
            "The encrypted Schwab token was saved successfully. No order was placed.",
          success: true,
        })
      );
  } catch (error) {
    console.error(
      "[engine8-schwab] callback token exchange failed:",
      safeErrorMessage(error)
    );

    return res
      .status(502)
      .type("html")
      .send(
        htmlPage({
          title: "Schwab Connection Failed",
          heading:
            "Schwab token exchange failed",
          message:
            "Authorization reached the callback, but the token could not be exchanged or saved. No order was placed.",
          success: false,
        })
      );
  }
});

/**
 * GET /api/auth/schwab/accounts
 *
 * Read-only account-number/hash discovery.
 * Requires X-Engine8-Admin-Secret.
 *
 * The raw account hash is never returned by this route.
 */
router.get(
  "/accounts",
  requireEngine8Admin,
  async (_req, res) => {
    try {
      const result =
        await getSchwabAccountNumbers();

      const safeAccounts =
        result.accounts.map((account) => ({
          index: account.index,
          maskedAccountNumber:
            account.maskedAccountNumber,
          hasAccountHash:
            account.hasAccountHash,
        }));

      return res.json({
        ok: true,
        broker: "SCHWAB",
        accountCount:
          result.accountCount,
        accounts:
          safeAccounts,
        readOnly: true,
        canPlaceOrders: false,
        willPlaceOrder: false,
        ts: nowIso(),
      });
    } catch (error) {
      const status =
        Number(error?.status) || 500;

      return res
        .status(
          status === 401 ? 401 : 502
        )
        .json({
          ok: false,
          rejected: true,
          reason:
            "SCHWAB_ACCOUNTS_REQUEST_FAILED",
          reasonCodes: [
            "SCHWAB_ACCOUNTS_REQUEST_FAILED",
          ],
          message:
            safeErrorMessage(error),
          canPlaceOrders: false,
          willPlaceOrder: false,
        });
    }
  }
);

/**
 * POST /api/auth/schwab/select-account
 *
 * Manually selects one Schwab account by index.
 * Requires X-Engine8-Admin-Secret.
 *
 * Raw account hash is encrypted and never returned.
 */
router.post(
  "/select-account",
  requireEngine8Admin,
  async (req, res) => {
    try {
      const result =
        await selectSchwabAccountByIndex({
          accountIndex:
            req.body?.accountIndex,
          expectedMaskedAccountNumber:
            req.body?.expectedMaskedAccountNumber,
          selectedBy:
            "BRIAN",
        });

      return res
        .status(
          result.rejected ? 409 : 200
        )
        .json(result);
    } catch (error) {
      return res.status(502).json({
        ok: false,
        rejected: true,
        reason:
          "SCHWAB_ACCOUNT_SELECTION_FAILED",
        reasonCodes: [
          "SCHWAB_ACCOUNT_SELECTION_FAILED",
        ],
        message:
          safeErrorMessage(error),
        canPlaceOrders: false,
        willPlaceOrder: false,
      });
    }
  }
);

export default router;
