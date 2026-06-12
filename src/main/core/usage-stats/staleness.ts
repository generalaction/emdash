/** True when a snapshot's generatedAt is older than ttlMs (or missing/unparseable). */
export function isSnapshotStale(generatedAt: string, nowMs: number, ttlMs: number): boolean {
  const t = new Date(generatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return nowMs - t > ttlMs;
}
