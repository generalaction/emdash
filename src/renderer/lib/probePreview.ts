export async function probeLocalUrls(
  candidates: string[],
  perProbeMs = 900,
  totalBudgetMs = 6000,
  excludePorts: number[] = []
): Promise<string | null> {
  const start = Date.now();
  const excluded = new Set(excludePorts.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
  const tryUrl = async (u: string): Promise<boolean> => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), perProbeMs);
    try {
      await fetch(u, { method: 'GET', mode: 'no-cors', signal: c.signal });
      // mode: 'no-cors' will resolve regardless of CORS; if it resolves, the server is there.
      clearTimeout(t);
      return true;
    } catch {
      clearTimeout(t);
      return false;
    }
  };
  const tried = new Set<string>();
  while (Date.now() - start < totalBudgetMs) {
    for (const u of candidates) {
      try {
        const portStr = new URL(u).port;
        const port = Number(portStr || 0);
        if (excluded.has(port)) continue;
      } catch {}
      if (tried.has(u)) continue;
      tried.add(u);
      if (await tryUrl(u)) return u;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
