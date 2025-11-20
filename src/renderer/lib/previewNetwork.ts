export const PROBE_TIMEOUT_MS = 900;
export const SPINNER_MAX_MS = 30000;
export const FALLBACK_DELAY_MS = 5000;

export async function isReachable(
  url?: string | null,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<boolean> {
  const u = (url || '').trim();
  if (!u) return false;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    await fetch(u, { method: 'GET', mode: 'no-cors', signal: c.signal });
    clearTimeout(t);
    return true;
  } catch {
    clearTimeout(t);
    return false;
  }
}

export function isAppPort(url: string, appPort: number): boolean {
  try {
    const p = Number(new URL(url).port || 0);
    return appPort !== 0 && p === appPort;
  } catch {
    return false;
  }
}
