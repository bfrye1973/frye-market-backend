// services/core/logic/engine29/structure/buildStructureBundle.js

import { buildEngine29SymbolStructure } from "./buildSymbolStructure.js";

export function buildEngine29StructureBundle(marketDataBundle, { now = Date.now() } = {}) {
  const sourceSymbols = marketDataBundle?.symbols || {};
  const symbols = {};

  for (const [canonicalSymbol, entry] of Object.entries(sourceSymbols)) {
    symbols[canonicalSymbol] = buildEngine29SymbolStructure(entry, { now });
  }

  const structuralAvailableSymbols = [];
  const tacticalAvailableSymbols = [];
  const missingStructureSymbols = [];

  for (const [symbol, entry] of Object.entries(symbols)) {
    if (entry?.structural) structuralAvailableSymbols.push(symbol);
    else missingStructureSymbols.push(symbol);
    if (entry?.tactical) tacticalAvailableSymbols.push(symbol);
  }

  return {
    version: "engine29.structure.v1",
    timestamp: new Date(now).toISOString(),
    dataDegraded: Boolean(marketDataBundle?.dataDegraded) || missingStructureSymbols.length > 0,
    symbols,
    summary: {
      structuralAvailableSymbols,
      tacticalAvailableSymbols,
      missingStructureSymbols,
      structuralAvailableCount: structuralAvailableSymbols.length,
      tacticalAvailableCount: tacticalAvailableSymbols.length,
      missingStructureCount: missingStructureSymbols.length,
    },
  };
}
