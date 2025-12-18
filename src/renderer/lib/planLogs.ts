export async function logPlanEvent(taskPath: string, message: string) {
  try {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${message}\n`;
    const fp = `${taskPath}/.emdash/plan.log`;
    await (window as any).electronAPI.debugAppendLog(fp, line, { reset: false });
  } catch {}
}
