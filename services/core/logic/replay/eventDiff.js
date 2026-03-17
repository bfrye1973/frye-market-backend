// services/core/logic/replay/eventDiff.js
function pickDecisionFields(s) {
  return {
    permission: s?.decision?.permission ?? null,
    setupLabel: s?.decision?.setupLabel ?? s?.decision?.label ?? null,
  };
}

function pickFibInvalidated(s) {
  return !!(s?.fib?.signals?.invalidated);
}

export function diffToEvents(prev, next) {
  const events = [];
  const prevD = pickDecisionFields(prev);
  const nextD = pickDecisionFields(next);

  // Permission changed
  if (prevD.permission && nextD.permission && prevD.permission !== nextD.permission) {
    events.push({
      tsUtc: next.tsUtc,
      type: "PERMISSION_CHANGED",
      from: prevD.permission,
      to: nextD.permission,
      reasonCodes: next?.decision?.reasonCodes ?? [],
      refs: {},
    });
  }

  // Setup label change
  if (prevD.setupLabel && nextD.setupLabel && prevD.setupLabel !== nextD.setupLabel) {
    events.push({
      tsUtc: next.tsUtc,
      type: "SETUP_DETECTED",
      from: prevD.setupLabel,
      to: nextD.setupLabel,
      reasonCodes: next?.decision?.reasonCodes ?? [],
      refs: {},
    });
  }

  // Fib invalidated
  const prevInv = pickFibInvalidated(prev);
  const nextInv = pickFibInvalidated(next);
  if (!prevInv && nextInv) {
    events.push({
      tsUtc: next.tsUtc,
      type: "FIB_INVALIDATED",
      from: false,
      to: true,
      reasonCodes: [],
      refs: {},
    });
  }

  return events;
}
