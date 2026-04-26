import os from 'node:os';
import { app } from 'electron';
import pidusage from 'pidusage';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import { parsePtySessionId } from '@shared/ptySessionId';
import type {
  ResourceAppProcess,
  ResourceAppUsage,
  ResourcePtyEntry,
  ResourceSnapshot,
} from '@shared/resource-monitor';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const SAMPLE_INTERVAL_MS = 1500;
const CPU_COUNT = os.cpus().length;
const TOTAL_MEMORY_BYTES = os.totalmem();

export async function sampleOnce(): Promise<ResourceSnapshot> {
  const active = ptySessionRegistry.listActiveSessions();
  const localPids = active
    .map((a) => a.pid)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  let usage: Record<string, { cpu: number; memory: number; ppid?: number }> = {};
  if (localPids.length > 0) {
    try {
      usage = await pidusage(localPids);
    } catch {
      // A dead PID rejects the whole batch — fall back to per-pid sampling in parallel.
      const results = await Promise.allSettled(localPids.map((pid) => pidusage(pid)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          usage[String(localPids[i])] = {
            cpu: r.value.cpu,
            memory: r.value.memory,
            ppid: r.value.ppid,
          };
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
      ppid: u?.ppid,
      cpu: u?.cpu ?? 0,
      memory: u?.memory ?? 0,
    });
  }

  const { usage: appUsage, processes: appProcesses } = sampleAppUsage();
  return {
    timestamp: Date.now(),
    cpuCount: CPU_COUNT,
    totalMemoryBytes: TOTAL_MEMORY_BYTES,
    app: appUsage,
    appProcesses,
    entries,
  };
}

/**
 * Sum memory + CPU across all Electron processes (main, renderer, GPU, utility)
 * and capture each row individually. `workingSetSize` is reported in KiB;
 * `percentCPUUsage` is % of one core.
 */
function sampleAppUsage(): { usage: ResourceAppUsage; processes: ResourceAppProcess[] } {
  try {
    const metrics = app.getAppMetrics();
    let memoryBytes = 0;
    let cpuPercent = 0;
    const processes: ResourceAppProcess[] = [];
    for (const m of metrics) {
      const memBytes = m.memory.workingSetSize * 1024;
      memoryBytes += memBytes;
      cpuPercent += m.cpu.percentCPUUsage;
      processes.push({
        pid: m.pid,
        type: m.type,
        name: m.name ?? m.serviceName,
        cpu: m.cpu.percentCPUUsage,
        memory: memBytes,
      });
    }
    return { usage: { memoryBytes, cpuPercent }, processes };
  } catch (err) {
    log.warn('resource-sampler: app metrics failed', err);
    return { usage: { memoryBytes: 0, cpuPercent: 0 }, processes: [] };
  }
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

export async function reconcileResourceSampler(): Promise<void> {
  try {
    const { enabled } = await appSettingsService.get('resourceMonitor');
    if (enabled) startResourceSampler();
    else stopResourceSampler();
  } catch (err) {
    log.warn('resource-sampler: failed to read settings', err);
  }
}
