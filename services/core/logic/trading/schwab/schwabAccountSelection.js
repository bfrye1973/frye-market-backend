// services/core/logic/trading/schwab/schwabAccountSelection.js
// Engine 8 — manual Schwab account selection.
//
// Fetches current Schwab accounts, selects one by index,
// and saves its hash encrypted.
//
// This file does not place orders.

import { getSchwabAccountNumbers } from "./schwabClient.js";
import {
  saveSelectedSchwabAccount,
  readSelectedSchwabAccount,
} from "./schwabAccountStore.js";

export async function selectSchwabAccountByIndex({
  accountIndex,
  expectedMaskedAccountNumber,
  selectedBy = "BRIAN",
}) {
  const normalizedIndex = Number(accountIndex);
  const normalizedExpectedMasked = String(
    expectedMaskedAccountNumber || ""
  ).trim();

  if (
    !Number.isInteger(normalizedIndex) ||
    normalizedIndex < 0
  ) {
    return {
      ok: false,
      rejected: true,
      reason: "INVALID_SCHWAB_ACCOUNT_INDEX",
      reasonCodes: ["INVALID_SCHWAB_ACCOUNT_INDEX"],
    };
  }

  if (!normalizedExpectedMasked) {
    return {
      ok: false,
      rejected: true,
      reason: "MISSING_EXPECTED_MASKED_ACCOUNT_NUMBER",
      reasonCodes: [
        "MISSING_EXPECTED_MASKED_ACCOUNT_NUMBER",
      ],
    };
  }

  const result = await getSchwabAccountNumbers();

  const selectedAccount = result.accounts.find(
    (account) => account.index === normalizedIndex
  );

  if (!selectedAccount) {
    return {
      ok: false,
      rejected: true,
      reason: "SCHWAB_ACCOUNT_INDEX_NOT_FOUND",
      reasonCodes: ["SCHWAB_ACCOUNT_INDEX_NOT_FOUND"],
    };
  }

  if (
    selectedAccount.maskedAccountNumber !==
    normalizedExpectedMasked
  ) {
    return {
      ok: false,
      rejected: true,
      reason: "SCHWAB_ACCOUNT_MASK_MISMATCH",
      reasonCodes: ["SCHWAB_ACCOUNT_MASK_MISMATCH"],
      expectedMaskedAccountNumber:
        normalizedExpectedMasked,
      actualMaskedAccountNumber:
        selectedAccount.maskedAccountNumber,
    };
  }

  if (!selectedAccount.accountHash) {
    return {
      ok: false,
      rejected: true,
      reason: "SCHWAB_ACCOUNT_HASH_MISSING",
      reasonCodes: ["SCHWAB_ACCOUNT_HASH_MISSING"],
    };
  }

  const saved = saveSelectedSchwabAccount({
    accountHash: selectedAccount.accountHash,
    maskedAccountNumber:
      selectedAccount.maskedAccountNumber,
    selectedBy,
  });

  return {
    ok: true,
    rejected: false,
    broker: "SCHWAB",
    selectedAccountPresent: true,
    maskedAccountNumber:
      saved.maskedAccountNumber,
    selectedAt: saved.selectedAt,
    canPlaceOrders: false,
    willPlaceOrder: false,
  };
}

export function getSelectedSchwabAccountForInternalUse() {
  const selected = readSelectedSchwabAccount();

  if (!selected?.accountHash) {
    throw new Error(
      "SCHWAB_SELECTED_ACCOUNT_NOT_CONFIGURED"
    );
  }

  return selected;
}

export default {
  selectSchwabAccountByIndex,
  getSelectedSchwabAccountForInternalUse,
};
