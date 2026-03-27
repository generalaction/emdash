import os from 'node:os';
import { BrowserWindow, app, ipcMain, webContents } from 'electron';
import { inArray } from 'drizzle-orm';
import { log } from '../lib/logger';
import type {
  AppMetrics,
  HostMetrics,
  ProjectMetrics,
  ResourceMetricsSnapshot,
  SessionMetrics,
  TaskMetrics,
} from '../../shared/performanceTypes';
import { parsePtyId } from '../../shared/ptyId';
import { getProvider } from '../../shared/providers/registry';
import { getActivePtyInfo } from '../services/ptyManager';
import { databaseService } from '../services/DatabaseService';
import { getDrizzleClient } from '../db/drizzleClient';
import { conversations as conversationsTable } from '../db/schema';
import { captureProcessSnapshot, getSubtreeResources } from '../lib/processTree';

// ── Helpers ──────────────────────────────────────────────────────────

function fin(v: unknown): number {
  if (typeof v !== 'number' || !isFinite(v)) return 0;
  return Math.max(0, v);
}

function createHostMetrics(): HostMetrics {
  const totalMemory = fin(os.totalmem());
  const freeMemory = fin(os.freemem());
  const usedMemory = Math.max(0, totalMemory - freeMemory);
  return {
    totalMemory,
    freeMemory,
    usedMemory,
    memoryUsagePercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
    cpuCoreCount: Math.max(1, os.cpus().length),
  };
}

function collectAppMetrics(): AppMetrics {
  const electronMetrics = app.getAppMetrics();
  const main = { cpu: 0, memory: 0 };
  const renderer = { cpu: 0, memory: 0 };
  const other = { cpu: 0, memory: 0 };

  for (const proc of electronMetrics) {
    const cpu = fin(proc.cpu?.percentCPUUsage);
    // Electron returns workingSetSize in KB
    const memory = fin(proc.memory?.workingSetSize) * 1024;
    const type = proc.type.toLowerCase();
    if (type === 'browser') {
      main.cpu += cpu;
      main.memory += memory;
    } else if (type === 'renderer' || type === 'tab') {
      renderer.cpu += cpu;
      renderer.memory += memory;
    } else {
      other.cpu += cpu;
      other.memory += memory;
    }
  }

  return {
    cpu: main.cpu + renderer.cpu + other.cpu,
    memory: main.memory + renderer.memory + other.memory,
    main,
    renderer,
    other,
  };
}

// ── Snapshot caching ─────────────────────────────────────────────────

const INTERACTIVE_MAX_AGE_MS = 1_000;
const IDLE_MAX_AGE_MS = 15_000;

let cachedSnapshot: ResourceMetricsSnapshot | null = null;
let inflightCollection: Promise<ResourceMetricsSnapshot> | null = null;

function emptySnapshot(): ResourceMetricsSnapshot {
  return {
    app: {
      cpu: 0,
      memory: 0,
      main: { cpu: 0, memory: 0 },
      renderer: { cpu: 0, memory: 0 },
      other: { cpu: 0, memory: 0 },
    },
    projects: [],
    host: createHostMetrics(),
    totalCpu: 0,
    totalMemory: 0,
    collectedAt: Date.now(),
  };
}

async function collectNow(): Promise<ResourceMetricsSnapshot> {
  const appMetrics = collectAppMetrics();

  // ── Per-PTY resource usage via process tree ────────────────────────
  const ptyInfos = getActivePtyInfo();
  const pidsToQuery = ptyInfos
    .map((p) => p.pid)
    .filter((pid): pid is number => pid !== null && pid > 0);

  const processSnapshot = pidsToQuery.length > 0 ? await captureProcessSnapshot() : null;

  // Map ptyId → resources
  const ptyResources = new Map<string, { cpu: number; memory: number }>();
  for (const info of ptyInfos) {
    if (info.pid && info.pid > 0 && processSnapshot) {
      const res = getSubtreeResources(processSnapshot, info.pid);
      ptyResources.set(info.ptyId, { cpu: fin(res.cpu), memory: fin(res.memory) });
    } else {
      ptyResources.set(info.ptyId, { cpu: 0, memory: 0 });
    }
  }

  // ── Resolve PTY → task → project via DB + ptyId parsing ───────────
  // Parse pty IDs to figure out which task they belong to
  type PtyMeta = {
    providerId: string;
    providerName: string;
    kind: 'main' | 'chat';
    taskId: string;
    suffix: string;
  };
  const ptyMeta = new Map<string, PtyMeta>();

  for (const info of ptyInfos) {
    const parsed = parsePtyId(info.ptyId);
    if (!parsed) continue;

    // For 'main' PTYs, suffix = taskId. For 'chat' PTYs, suffix = conversationId.
    // We need the taskId; for chat PTYs we'll try to resolve it later.
    const provider = getProvider(parsed.providerId);
    ptyMeta.set(info.ptyId, {
      providerId: parsed.providerId,
      providerName: provider?.name ?? parsed.providerId,
      kind: parsed.kind,
      taskId: parsed.kind === 'main' ? parsed.suffix : '', // chat PTYs need resolution
      suffix: parsed.suffix,
    });
  }

  // Hoist DB fetches (used by both chat resolution and hierarchy building)
  let allTasks: Array<{ id: string; projectId: string; name: string }> = [];
  let allProjects: Array<{ id: string; name: string }> = [];
  try {
    [allTasks, allProjects] = await Promise.all([
      databaseService.getTasks(),
      databaseService.getProjects(),
    ]);
  } catch (err) {
    log.warn('perf:collectNow - failed to fetch tasks/projects', { error: err });
  }

  // Resolve chat PTY taskIds via a single batch query on the conversations table
  const chatPtysNeedingResolution = [...ptyMeta.entries()].filter(
    ([, m]) => m.kind === 'chat' && !m.taskId
  );
  if (chatPtysNeedingResolution.length > 0) {
    try {
      // Collect the conversation IDs we need to resolve
      const convIdToPtyIds = new Map<string, string[]>();
      for (const [ptyId] of chatPtysNeedingResolution) {
        const meta = ptyMeta.get(ptyId);
        if (meta?.suffix) {
          const existing = convIdToPtyIds.get(meta.suffix) ?? [];
          existing.push(ptyId);
          convIdToPtyIds.set(meta.suffix, existing);
        }
      }

      if (convIdToPtyIds.size > 0) {
        // Single query: SELECT id, task_id FROM conversations WHERE id IN (...)
        const { db } = await getDrizzleClient();
        const rows = await db
          .select({ id: conversationsTable.id, taskId: conversationsTable.taskId })
          .from(conversationsTable)
          .where(inArray(conversationsTable.id, [...convIdToPtyIds.keys()]));

        for (const row of rows) {
          const ptyIds = convIdToPtyIds.get(row.id);
          if (ptyIds) {
            for (const ptyId of ptyIds) {
              const meta = ptyMeta.get(ptyId);
              if (meta) meta.taskId = row.taskId;
            }
          }
        }
      }
    } catch (err) {
      log.warn('perf:collectNow - failed to resolve chat PTY task IDs', { error: err });
    }
  }

  // ── Build project → task → session hierarchy ──────────────────────

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const ptyInfoById = new Map(ptyInfos.map((p) => [p.ptyId, p]));

  // Group by task, then by project
  const taskSessions = new Map<string, SessionMetrics[]>();
  for (const [ptyId, meta] of ptyMeta) {
    if (!meta.taskId) continue;
    const res = ptyResources.get(ptyId) ?? { cpu: 0, memory: 0 };
    const info = ptyInfoById.get(ptyId);
    const session: SessionMetrics = {
      ptyId,
      providerId: meta.providerId,
      providerName: meta.providerName,
      kind: meta.kind,
      pid: info?.pid ?? null,
      cpu: res.cpu,
      memory: res.memory,
    };
    const existing = taskSessions.get(meta.taskId) ?? [];
    existing.push(session);
    taskSessions.set(meta.taskId, existing);
  }

  // Group tasks by project
  const projectTasks = new Map<string, TaskMetrics[]>();
  for (const [taskId, sessions] of taskSessions) {
    const task = taskMap.get(taskId);
    const projectId = task?.projectId ?? 'unknown';

    const taskCpu = sessions.reduce((s, sess) => s + sess.cpu, 0);
    const taskMem = sessions.reduce((s, sess) => s + sess.memory, 0);

    const taskMetrics: TaskMetrics = {
      taskId,
      taskName: task?.name ?? 'Unknown Task',
      cpu: taskCpu,
      memory: taskMem,
      sessions,
    };

    const existing = projectTasks.get(projectId) ?? [];
    existing.push(taskMetrics);
    projectTasks.set(projectId, existing);
  }

  const projects: ProjectMetrics[] = [];
  for (const [projectId, tasks] of projectTasks) {
    const project = projectMap.get(projectId);
    const projCpu = tasks.reduce((s, t) => s + t.cpu, 0);
    const projMem = tasks.reduce((s, t) => s + t.memory, 0);
    projects.push({
      projectId,
      projectName: project?.name ?? 'Unknown Project',
      cpu: projCpu,
      memory: projMem,
      tasks,
    });
  }

  const sessionCpuTotal = projects.reduce((s, p) => s + p.cpu, 0);
  const sessionMemTotal = projects.reduce((s, p) => s + p.memory, 0);

  return {
    app: appMetrics,
    projects,
    host: createHostMetrics(),
    totalCpu: appMetrics.cpu + sessionCpuTotal,
    totalMemory: appMetrics.memory + sessionMemTotal,
    collectedAt: Date.now(),
  };
}

async function getSnapshot(
  mode: 'interactive' | 'idle' = 'interactive',
  force = false
): Promise<ResourceMetricsSnapshot> {
  const maxAge = mode === 'interactive' ? INTERACTIVE_MAX_AGE_MS : IDLE_MAX_AGE_MS;

  if (!force && cachedSnapshot) {
    const age = Date.now() - cachedSnapshot.collectedAt;
    if (age <= maxAge) return cachedSnapshot;
  }

  if (inflightCollection) return inflightCollection;

  inflightCollection = (async () => {
    try {
      const snapshot = await collectNow();
      cachedSnapshot = snapshot;
      return snapshot;
    } catch (err) {
      log.warn('perf:getSnapshot - failed to collect metrics', { error: err });
      const fallback = cachedSnapshot ?? emptySnapshot();
      cachedSnapshot = fallback;
      return fallback;
    } finally {
      inflightCollection = null;
    }
  })();

  return inflightCollection;
}

// ── Polling for active subscribers ───────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;

/** Track subscriber count per webContents id — prevents leaked polling on renderer crash. */
const subscribersByWebContents = new Map<number, number>();
const cleanedUpWebContents = new Set<number>();

function totalSubscribers(): number {
  let total = 0;
  for (const count of subscribersByWebContents.values()) total += count;
  return total;
}

function cleanupWebContents(webContentsId: number) {
  if (cleanedUpWebContents.has(webContentsId)) return;
  cleanedUpWebContents.add(webContentsId);
  subscribersByWebContents.delete(webContentsId);
  if (totalSubscribers() === 0) stopPolling();
}

function broadcastSnapshot(snapshot: ResourceMetricsSnapshot) {
  // Only send to webContents that called perf:subscribe (not every window).
  // Snapshot the keys to avoid mutation during iteration.
  for (const wcId of [...subscribersByWebContents.keys()]) {
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed()) {
      wc.send('perf:snapshot', snapshot);
    } else {
      // webContents is gone — clean up the stale subscription entry
      cleanupWebContents(wcId);
    }
  }
}

const POLL_INTERVAL_MS = 1_000;

let lastBroadcastCpu = -1;
let lastBroadcastMem = -1;
let lastBroadcastProjectCount = -1;

function startPolling() {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    const snapshot = await getSnapshot('interactive', true);
    // Skip broadcast when nothing meaningfully changed
    if (
      snapshot.totalCpu === lastBroadcastCpu &&
      snapshot.totalMemory === lastBroadcastMem &&
      snapshot.projects.length === lastBroadcastProjectCount
    ) {
      return;
    }
    lastBroadcastCpu = snapshot.totalCpu;
    lastBroadcastMem = snapshot.totalMemory;
    lastBroadcastProjectCount = snapshot.projects.length;
    broadcastSnapshot(snapshot);
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ── IPC registration ─────────────────────────────────────────────────

export function registerPerformanceIpc() {
  ipcMain.handle('perf:subscribe', async (event) => {
    const wcId = event.sender.id;
    subscribersByWebContents.set(wcId, (subscribersByWebContents.get(wcId) ?? 0) + 1);
    cleanedUpWebContents.delete(wcId);

    // Automatically clean up if this webContents is destroyed (crash, close without unsubscribe)
    if (!event.sender.isDestroyed()) {
      event.sender.once('destroyed', () => cleanupWebContents(wcId));
    }

    startPolling();
    const snapshot = await getSnapshot('interactive');
    return { success: true, data: snapshot };
  });

  ipcMain.handle('perf:unsubscribe', (event) => {
    const wcId = event.sender.id;
    const current = subscribersByWebContents.get(wcId) ?? 0;
    if (current <= 1) {
      subscribersByWebContents.delete(wcId);
    } else {
      subscribersByWebContents.set(wcId, current - 1);
    }
    if (totalSubscribers() === 0) stopPolling();
    return { success: true };
  });

  ipcMain.handle('perf:getSnapshot', async (_event, mode?: string) => {
    try {
      const snapshot = await getSnapshot(mode === 'idle' ? 'idle' : 'interactive');
      return { success: true, data: snapshot };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
