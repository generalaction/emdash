import os from 'node:os';
import pidusage from 'pidusage';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import type { ResourcePtyEntry, ResourceSnapshot } from '@shared/resource-monitor';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const SAMPLE_INTERVAL_MS = 1500;

function parseSessionId(id: string): {
  projectId: string;
  scopeId: string;
  leafId: string;
} | null {
  const parts = id.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { projectId: parts[0], scopeId: parts[1], leafId: parts[2] };
}

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
      // A dead PID rejects the whole batch — fall back to per-pid sampling.
      for (const pid of localPids) {
        try {
          const u = (await pidusage(pid)) as { cpu: number; memory: number };
          usage[String(pid)] = { cpu: u.cpu, memory: u.memory };
        } catch {
          // process gone — skip
        }
      }
    }
  }

  const entries: ResourcePtyEntry[] = [];
  for (const a of active) {
    const parsed = parseSessionId(a.sessionId);
    if (!parsed) continue;
    const u = typeof a.pid === 'number' ? usage[String(a.pid)] : undefined;
    entries.push({
      sessionId: a.sessionId,
      projectId: parsed.projectId,
      scopeId: parsed.scopeId,
      leafId: parsed.leafId,
      pid: a.pid,
      kind: typeof a.pid === 'number' ? 'local' : 'ssh',
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

export function startResourceSampler(): void {
  if (timer) return;
  const tick = async () => {
    try {
      const snap = await sampleOnce();
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
