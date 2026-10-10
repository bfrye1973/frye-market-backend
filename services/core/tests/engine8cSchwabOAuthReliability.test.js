import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  exchangeSchwabAuthorizationCode,
  getValidSchwabAccessToken,
  classifySchwabFailure,
} from "../logic/trading/schwab/schwabClient.js";
import {
  readSchwabTokens,
  saveSchwabTokens,
  getSafeTokenStatus,
} from "../logic/trading/schwab/schwabTokenStore.js";
import {
  readEngine8RealFillObserverState,
  markEngine8RealFillRecoveryRequired,
  updateEngine8RealFillAccountWatermark,
} from "../logic/trading/schwab/engine8RealFillStore.js";
import { summarizeEngine8Health } from "../logic/trading/schwab/engine8AuthHealth.js";
import { computeEngine8RealFillQueryStart, resolveEngine8AccountRecoveryMode } from "../logic/trading/schwab/engine8RealFillObserver.js";

const originalFetch = globalThis.fetch;
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine8c-sch-"));
process.env.SCHWAB_PRIVATE_DATA_DIR = baseDir;
process.env.SCHWAB_TOKEN_ENCRYPTION_KEY = "test-only-not-production";
process.env.SCHWAB_APP_KEY = "test-key";
process.env.SCHWAB_APP_SECRET = "test-secret";
process.env.SCHWAB_REDIRECT_URI = "https://localhost.example/api/auth/schwab/callback";
process.env.ENGINE8_ADMIN_SECRET = "test-admin";
process.env.PUSHOVER_ENABLED = "0";

test.after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(baseDir, { recursive: true, force: true });
});

test("new human authorization sets hard deadline; normal refresh and rotation preserve it", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, status: 200, text: async () => JSON.stringify(
      requests === 1
        ? { access_token: "access-a", refresh_token: "refresh-a", expires_in: 0.01, refresh_token_expires_in: 604800 }
        : { access_token: "access-b", refresh_token: "refresh-b", expires_in: 1800 }
    ) };
  };
  await exchangeSchwabAuthorizationCode("mock-code");
  const original = readSchwabTokens();
  assert.equal(original.authorizationDeadlineStatus, "KNOWN");
  assert.ok(original.lastAuthorizationAt);
  assert.ok(original.refreshTokenExpiresAt);
  await new Promise(resolve => setTimeout(resolve, 25));
  const [a,b] = await Promise.all([getValidSchwabAccessToken(), getValidSchwabAccessToken()]);
  assert.equal(a, "access-b");
  assert.equal(b, "access-b");
  assert.equal(requests, 2, "exactly one token refresh despite concurrent callers");
  const updated = readSchwabTokens();
  assert.equal(updated.refresh_token, "refresh-b", "rotated refresh token saved");
  assert.equal(updated.lastAuthorizationAt, original.lastAuthorizationAt);
  assert.equal(updated.refreshTokenExpiresAt, original.refreshTokenExpiresAt);
  assert.ok(updated.lastSuccessfulRefreshAt);
});

test("legacy credentials with unknown original authorization date remain unknown", () => {
  fs.rmSync(path.join(baseDir,"schwab-token.enc.json"), { force:true });
  saveSchwabTokens({ access_token: "legacy-access", refresh_token: "legacy-refresh", expires_in: 1800,
    refresh_token_expires_in: 604800 });
  const t = readSchwabTokens();
  assert.equal(t.authorizationDeadlineStatus, "AUTH_DEADLINE_UNKNOWN");
  assert.equal(t.refreshTokenExpiresAt, null);
  assert.equal(getSafeTokenStatus().authorizationDeadlineStatus, "AUTH_DEADLINE_UNKNOWN");
  assert.equal(summarizeEngine8Health().authHealth, "AUTH_DEADLINE_UNKNOWN");
});

test("broker failures are classified without exposing response secrets", () => {
  for (const [error, expected] of [
    [{status:400,brokerCode:"invalid_grant"},"SCHWAB_INVALID_GRANT"],
    [{status:429},"SCHWAB_RATE_LIMITED"],
    [{status:502},"SCHWAB_TEMPORARY_FAILURE"],
    [{status:401},"SCHWAB_AUTHORIZATION_REJECTED"],
    [{message:"timeout"},"SCHWAB_TEMPORARY_FAILURE"]
  ]) assert.equal(classifySchwabFailure(error),expected);
});

test("account-specific recovery survives state reload and remains bounded by bootstrap", () => {
  markEngine8RealFillRecoveryRequired(["SCHWAB_6380","SCHWAB_0747"],"TOKEN_FAILURE");
  updateEngine8RealFillAccountWatermark("SCHWAB_6380", {
    lastBrokerFillTimeSeen:"2026-10-08T12:07:45.000Z",
    recoveryRequired:false,
    recoveryReason:null,
  });
  const state = readEngine8RealFillObserverState();
  assert.equal(state.accounts.SCHWAB_6380.recoveryRequired,false);
  assert.equal(state.accounts.SCHWAB_0747.recoveryRequired,true);
  assert.equal(resolveEngine8AccountRecoveryMode(false,state.accounts.SCHWAB_6380),false);
  assert.equal(resolveEngine8AccountRecoveryMode(false,state.accounts.SCHWAB_0747),true);
  const start = computeEngine8RealFillQueryStart({
    deliveryEnabled:true,recoveryMode:true,
    bootstrapStartedAt:"2026-09-01T19:59:29.555Z",
    lastBrokerFillTimeSeen:state.accounts.SCHWAB_6380.lastBrokerFillTimeSeen,
    now:new Date("2026-10-10T18:00:00.000Z"),
    recoveryOverlapMinutes:5,
  });
  assert.equal(start,"2026-10-08T12:02:45.000Z");
  assert.equal(summarizeEngine8Health().journalSyncHealth,"RECOVERY_PENDING");
});
