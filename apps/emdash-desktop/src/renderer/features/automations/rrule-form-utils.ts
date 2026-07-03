export function getStoredDtstartLine(expr: string): string | null {
  return expr.split('\n').find((line) => /^DTSTART(?:;[^:]*)?:/i.test(line)) ?? null;
}

export function getEditableRRuleExpr(expr: string): string {
  const rruleLine = expr.split('\n').find((line) => /^RRULE:/i.test(line));
  return rruleLine ? rruleLine.replace(/^RRULE:/i, '') : expr;
}

function withRRulePrefix(expr: string): string {
  return /^RRULE\b/im.test(expr) ? expr : `RRULE:${expr}`;
}

export function buildRRuleTriggerExpr(expr: string, storedExpr?: string): string {
  const trimmed = expr.trim();
  if (/^DTSTART(?:;[^:]*)?:/im.test(trimmed)) return trimmed;

  const dtstartLine = storedExpr ? getStoredDtstartLine(storedExpr) : null;
  return dtstartLine ? `${dtstartLine}\n${withRRulePrefix(trimmed)}` : trimmed;
}
