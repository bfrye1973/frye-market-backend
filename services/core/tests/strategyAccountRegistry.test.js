import test from "node:test";
import assert from "node:assert/strict";

import {
  getStrategyAccountRegistry,
  resolveStrategyAccountRole,
} from "../logic/accounts/strategyAccountRegistry.js";

test("locked six-account capital plan totals 46k including 8k reserve", () => {
  const registry = getStrategyAccountRegistry();
  assert.equal(registry.capital.total, 46000);
  assert.equal(registry.capital.strategyAccounts, 38000);
  assert.equal(registry.capital.reserve, 8000);
  assert.equal(registry.capital.balanced, true);
  assert.equal(registry.accounts.length, 6);
});

test("locked role capital and MES caps match manager plan", () => {
  const registry = getStrategyAccountRegistry();
  const byRole = Object.fromEntries(registry.accounts.map((a) => [a.accountRole, a]));
  assert.deepEqual(
    {
      INTRADAY: [byRole.INTRADAY.capitalTarget, byRole.INTRADAY.normalMesMax],
      SUBMINUTE: [byRole.SUBMINUTE.capitalTarget, byRole.SUBMINUTE.normalMesMax],
      MINUTE: [byRole.MINUTE.capitalTarget, byRole.MINUTE.normalMesMax],
      MINOR: [byRole.MINOR.capitalTarget, byRole.MINOR.normalMesMax],
      INTERMEDIATE: [byRole.INTERMEDIATE.capitalTarget, byRole.INTERMEDIATE.normalMesMax],
      PRIMARY: [byRole.PRIMARY.capitalTarget, byRole.PRIMARY.normalMesMax],
    },
    {
      INTRADAY: [16000, 5],
      SUBMINUTE: [10000, 4],
      MINUTE: [3000, 1],
      MINOR: [3000, 1],
      INTERMEDIATE: [3000, 1],
      PRIMARY: [3000, 1],
    }
  );
});

test("existing Schwab accounts resolve without rewriting legacy journal names", () => {
  const intraday = resolveStrategyAccountRole({ brokerAccountLabel: "SCHWAB_6380", legacyJournalAccount: "INTRADAY" });
  const subminute = resolveStrategyAccountRole({ brokerAccountLabel: "SCHWAB_0747", legacyJournalAccount: "SWING" });
  assert.equal(intraday.account.accountRole, "INTRADAY");
  assert.equal(intraday.account.degree, "micro");
  assert.equal(subminute.account.accountRole, "SUBMINUTE");
  assert.equal(subminute.account.degree, "subminute");
  assert.equal(subminute.account.brokerBinding.legacyJournalAccount, "SWING");
});

test("new higher-degree slots remain unbound until Schwab accounts exist", () => {
  const registry = getStrategyAccountRegistry();
  for (const role of ["MINUTE", "MINOR", "INTERMEDIATE", "PRIMARY"]) {
    const account = registry.accounts.find((item) => item.accountRole === role);
    assert.equal(account.brokerBinding.status, "AWAITING_NEW_SCHWAB_ACCOUNT");
    assert.equal(account.brokerBinding.brokerAccountLabel, null);
  }
});

test("registry carries no trading authority", () => {
  const registry = getStrategyAccountRegistry();
  assert.equal(registry.guardrails.noSizingAuthority, true);
  assert.equal(registry.guardrails.noOrderCreation, true);
  assert.equal(registry.guardrails.noJournalMutation, true);
});