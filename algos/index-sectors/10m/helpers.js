// helpers.js — safe math/eval for tilt, outlook, grade

export function evaluateTilt(expr, breadth, momentum) {
  try {
    const safe = Function("breadth", "momentum", `return ${expr};`);
    const v = safe(breadth, momentum);
    return Math.max(0, Math.min(100, Number(v)));
  } catch (_) {
    return (breadth + momentum) / 2;
  }
}

export function evaluateOutlook(rules, breadth, momentum) {
  function test(rule) {
    const parts = rule.split("&&").map(s => s.trim());
    for (const part of parts) {
      if (part.includes(">=")) {
        const [left, thr] = part.split(">=");
        if (left.trim() === "breadth"  && !(breadth  >= Number(thr))) return false;
        if (left.trim() === "momentum" && !(momentum >= Number(thr))) return false;
      }
      if (part.includes("<=")) {
        const [left, thr] = part.split("<=");
        if (left.trim() === "breadth"  && !(breadth  <= Number(thr))) return false;
        if (left.trim() === "momentum" && !(momentum <= Number(thr))) return false;
      }
    }
    return true;
  }

  if (test(rules.bullish)) return "bullish";
  if (test(rules.bearish)) return "bearish";
  return "neutral";
}

export function evaluateGrade(cfg, tilt) {
  const v = Number(tilt);
  const okThr    = Number(cfg.ok.replace(">=", ""));
  const warnThr  = Number(cfg.warn.replace(">=", ""));

  if (v >= okThr)   return "ok";
  if (v >= warnThr) return "warn";
  return "danger";
}
