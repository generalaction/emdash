import { execFile } from 'node:child_process';
import os from 'node:os';
import { app } from 'electron';
import pidusage from 'pidusage';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import { parsePtySessionId } from '@shared/ptySessionId';
import type {
  ResourceAppProcess,
  ResourceAppUsage,
  ResourcePtyEntry,
  ResourceSnapshot,
} from '@shared/resource-monitor';

const SAMPLE_INTERVAL_MS = 1500;
const CPU_COUNT = os.cpus().length;
const TOTAL_MEMORY_BYTES = os.totalmem();
const STALE_LOCAL_PTY_MEMORY_BYTES = 2 * 1024 * 1024;

type ProcessUsage = { cpu: number; memory: number; ppid?: number };
type ProcessUsageMap = Record<string, ProcessUsage>;
type ProcessTreeSnapshot = { trees: Map<number, number[]>; sampledPids: number[] };

export async function sampleOnce(): Promise<ResourceSnapshot> {
  const active = ptySessionRegistry.listActiveSessions();
  const localPids = active
    .map((a) => a.pid)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  const { trees: processTrees, sampledPids } = await listProcessTrees(localPids);
  const usage = await samplePidUsage(sampledPids);

  const entries: ResourcePtyEntry[] = [];
  for (const a of active) {
    const parsed = parsePtySessionId(a.sessionId);
    if (!parsed) continue;
    const tree = typeof a.pid === 'number' ? processTrees.get(a.pid) : undefined;
    const u = tree ? aggregateProcessUsage(tree, usage) : undefined;
    if (isStaleLocalPty(a.pid, u)) continue;
    entries.push({
      sessionId: a.sessionId,
      projectId: parsed.projectId,
      scopeId: parsed.scopeId,
      leafId: parsed.leafId,
      pid: a.pid,
      ppid: typeof a.pid === 'number' ? usage[String(a.pid)]?.ppid : undefined,
      cpu: u?.cpu ?? 0,
      memory: u?.memory ?? 0,
      providerId: a.metadata?.providerId,
      title: a.metadata?.title,
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

async function samplePidUsage(localPids: number[]): Promise<ProcessUsageMap> {
  if (localPids.length === 0) return {};
  try {
    return await pidusage(localPids);
  } catch {
    // A dead PID rejects the whole batch — fall back to per-pid sampling in parallel.
    const usage: ProcessUsageMap = {};
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
    return usage;
  }
}

/**
 * node-pty gives us the PTY's process group leader, which is usually a tiny
 * shell wrapper (`sh -c ...`). Agent CLIs and lifecycle scripts run as children
 * of that wrapper, so sampling only the root PID makes active agents look like
 * 3-6 MB shells. On POSIX, include descendants so the monitor reflects the
 * resource cost of the whole PTY session. Windows falls back to root PID
 * sampling, matching the previous behavior.
 */
async function listProcessTrees(localPids: number[]): Promise<ProcessTreeSnapshot> {
  const fallback = new Map(localPids.map((pid) => [pid, [pid]]));
  const fallbackSnapshot = { trees: fallback, sampledPids: localPids };
  if (localPids.length === 0 || process.platform === 'win32') return fallbackSnapshot;

  try {
    const stdout = await execFileText('ps', ['-axo', 'pid=,ppid=']);
    const livePids = new Set<number>();
    const childrenByParent = new Map<number, number[]>();
    for (const line of stdout.split('\n')) {
      const [pidText, ppidText] = line.trim().split(/\s+/);
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0 || ppid < 0) continue;
      livePids.add(pid);
      const siblings = childrenByParent.get(ppid) ?? [];
      siblings.push(pid);
      childrenByParent.set(ppid, siblings);
    }

    const trees = new Map<number, number[]>();
    for (const rootPid of localPids) {
      const visited = new Set<number>();
      const stack = [rootPid];
      while (stack.length > 0) {
        const pid = stack.pop();
        if (pid === undefined || visited.has(pid)) continue;
        visited.add(pid);
        const children = childrenByParent.get(pid);
        if (children) stack.push(...children);
      }
      trees.set(rootPid, [...visited]);
    }
    const sampledPids = [...new Set([...trees.values()].flat())].filter((pid) => livePids.has(pid));
    return { trees, sampledPids };
  } catch (err) {
    log.warn('resource-sampler: process tree lookup failed', err);
    return fallbackSnapshot;
  }
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(String(stdout));
    });
  });
}

function aggregateProcessUsage(pids: number[], usage: ProcessUsageMap): ProcessUsage | undefined {
  let cpu = 0;
  let memory = 0;
  let found = false;
  for (const pid of pids) {
    const item = usage[String(pid)];
    if (!item) continue;
    found = true;
    cpu += item.cpu;
    memory += item.memory;
  }
  return found ? { cpu, memory } : undefined;
}

function isStaleLocalPty(pid: number | undefined, usage: ProcessUsage | undefined): boolean {
  if (pid === undefined || !usage) return false;
  return usage.cpu === 0 && usage.memory < STALE_LOCAL_PTY_MEMORY_BYTES;
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
const openSubscriptions = new Set<string>();
const latestSequenceByClient = new Map<string, number>();

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
  timer = setInterval(() => void tick(), SAMPLE_INTERVAL_MS);
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

export function setResourceMonitorOpen(
  clientId: string,
  subscriptionId: string,
  open: boolean,
  sequence: number
): void {
  const latestSequence = latestSequenceByClient.get(clientId) ?? 0;
  if (sequence <= latestSequence) return;
  latestSequenceByClient.set(clientId, sequence);
  if (open) {
    openSubscriptions.add(subscriptionId);
  } else {
    openSubscriptions.delete(subscriptionId);
    latestSequenceByClient.delete(clientId);
  }
  void reconcileResourceSampler();
}

export async function reconcileResourceSampler(): Promise<void> {
  try {
    const { enabled } = await appSettingsService.get('resourceMonitor');
    if (enabled && openSubscriptions.size > 0) startResourceSampler();
    else stopResourceSampler();
  } catch (err) {
    log.warn('resource-sampler: failed to read settings', err);
  }
}
