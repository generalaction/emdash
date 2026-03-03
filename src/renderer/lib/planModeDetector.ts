export type PlanModeSignal = 'plan_ready' | 'plan_approved' | 'plan_rejected' | 'none';

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

export function detectPlanModeSignal(chunk: string): PlanModeSignal {
  const text = stripAnsi(chunk || '');
  if (!text) return 'none';

  if (/\.claude\/plans\/.*\.md/i.test(text)) return 'plan_ready';
  if (/here\s+is\s+(claude'?s?\s+)?plan/i.test(text)) return 'plan_ready';
  if (/ready\s+to\s+code\s*\?/i.test(text)) return 'plan_ready';
  if (/do\s+you\s+want\s+to\s+(proceed|execute|implement|approve)/i.test(text)) return 'plan_ready';
  if (/ExitPlanMode/i.test(text)) return 'plan_ready';

  if (/plan\s+(approved|accepted)/i.test(text)) return 'plan_approved';
  if (/exiting\s+plan\s+mode/i.test(text)) return 'plan_approved';
  if (/exited\s+plan\s+mode/i.test(text)) return 'plan_approved';
  if (/proceeding\s+with\s+(the\s+)?implementation/i.test(text)) return 'plan_approved';

  if (/plan\s+(rejected|declined)/i.test(text)) return 'plan_rejected';

  return 'none';
}
