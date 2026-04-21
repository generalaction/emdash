import os from 'node:os';
import pidusage from 'pidusage';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import { parsePtySessionId } from '@shared/ptySessionId';
import type { ResourcePtyEntry, ResourceSnapshot } from '@shared/resource-monitor';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const SAMPLE_INTERVAL_MS = 1500;

export async function sampleOnce(): Promise<ResourceSnapshot> {
  const active = ptySessionRegistry.listActiveSessions();
  const localPids = active
    .map((a) => a.pid)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  let usage: Record<string, { cpu: number; memory: number }> = {};
  if (localPids.length > 0) {
    try {
      usage = (await pidusage(localPids)) as Record<string, { cpu: number; memory: number }>;
    } catch {
      // A dead PID rejects the whole batch — fall back to per-pid sampling in parallel.
      const results = await Promise.allSettled(localPids.map((pid) => pidusage(pid)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const u = r.value as { cpu: number; memory: number };
          usage[String(localPids[i])] = { cpu: u.cpu, memory: u.memory };
        }
      });
    }
  }

  const entries: ResourcePtyEntry[] = [];
  for (const a of active) {
    const parsed = parsePtySessionId(a.sessionId);
    if (!parsed) continue;
    const u = typeof a.pid === 'number' ? usage[String(a.pid)] : undefined;
    entries.push({
      sessionId: a.sessionId,
      projectId: parsed.projectId,
      scopeId: parsed.scopeId,
      leafId: parsed.leafId,
      pid: a.pid,
      cpu: u?.cpu ?? 0,
      memory: u?.memory ?? 0,
    });
  }

  return {
    timestamp: Date.now(),
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    entries,
  };
}

let timer: NodeJS.Timeout | null = null;
let lastEntryCount = -1;

export function startResourceSampler(): void {
  if (timer) return;
  const tick = async () => {
    try {
      const snap = await sampleOnce();
      // Skip emit when nothing is running and nothing was running last tick —
      // avoids waking up every observer in the renderer every 1.5s while idle.
      if (snap.entries.length === 0 && lastEntryCount === 0) return;
      lastEntryCount = snap.entries.length;
      events.emit(resourceSnapshotChannel, snap);
    } catch (err) {
      log.warn('resource-sampler: sample failed', err);
    }
  };
  timer = setInterval(tick, SAMPLE_INTERVAL_MS);
  void tick();
}

export function stopResourceSampler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    try {
      pidusage.clear();
    } catch {
      // ignore
    }
  }
}
