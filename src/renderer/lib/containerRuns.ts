import type {
  RunnerEvent,
  RunnerErrorEvent,
  RunnerEventType,
  RunnerLifecycleEvent,
  RunnerLifecycleStatus,
  RunnerMode,
  RunnerPortsEvent,
  RunnerResultEvent,
} from '@shared/container';
import type { RunnerPortMapping } from '@shared/container';
import { log } from './logger';

type Listener = (event: RunnerEvent) => void;
type TaskListener = (state: ContainerRunState) => void;

interface StartRunArgs {
  taskId: string;
  taskPath: string;
  runId?: string;
  mode?: RunnerMode;
}

const listeners = new Set<Listener>();
const taskListeners = new Map<string, Set<TaskListener>>();
const taskStates = new Map<string, ContainerRunState>();
let subscribed = false;
let unsubscribe: (() => void) | undefined;

function clean(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function getOrCreateState(taskId: string): ContainerRunState {
  const existing = taskStates.get(taskId);
  if (existing) return existing;
  const created: ContainerRunState = {
    taskId,
    runId: undefined,
    status: 'idle',
    containerId: undefined,
    ports: [],
    previewService: undefined,
    previewUrl: undefined,
    lastUpdatedAt: 0,
    lastError: null,
  };
  taskStates.set(taskId, created);
  return created;
}

function clonePort(port: RunnerPortMapping): RunnerPortMapping & { url: string } {
  const url = port.url ?? `http://localhost:${port.host}`;
  return { ...port, url };
}

function updateTaskState(event: RunnerEvent) {
  const state = getOrCreateState(event.taskId);
  const isNewRun = state.runId && state.runId !== event.runId;
  if (!state.runId || isNewRun) {
    state.runId = event.runId;
    state.status = 'idle';
    state.containerId = undefined;
    state.ports = [];
    state.previewService = undefined;
    state.previewUrl = undefined;
    state.lastError = null;
  }

  switch (event.type as RunnerEventType) {
    case 'lifecycle': {
      const lifecycle = event as RunnerLifecycleEvent;
      state.status = lifecycle.status as RunnerLifecycleStatus;
      if (lifecycle.containerId) {
        state.containerId = lifecycle.containerId;
      }
      if (lifecycle.status === 'failed') {
        state.lastError ??= {
          code: 'UNKNOWN',
          message: 'Container failed unexpectedly',
        };
      }
      if (lifecycle.status === 'stopped') {
        state.previewUrl = undefined;
      }
      break;
    }
    case 'ports': {
      const portsEvent = event as RunnerPortsEvent;
      state.previewService = portsEvent.previewService;
      const seen = new Set<string>();
      const unique = [] as Array<RunnerPortMapping & { url: string }>;
      for (const p of portsEvent.ports) {
        const key = `${p.service}:${p.container}:${p.host}:${p.protocol || 'tcp'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(clonePort(p));
      }
      state.ports = unique;
      const previewPort = state.ports.find((p) => p.service === state.previewService && p.url);
      state.previewUrl = previewPort?.url;
      break;
    }
    case 'error': {
      const errorEvent = event as RunnerErrorEvent;
      state.lastError = {
        code: errorEvent.code,
        message: errorEvent.message,
      };
      break;
    }
    case 'result': {
      const resultEvent = event as RunnerResultEvent;
      if (resultEvent.status === 'failed') {
        state.lastError ??= {
          code: 'UNKNOWN',
          message: 'Container run failed',
        };
      }
      break;
    }
    default:
      break;
  }
  state.lastUpdatedAt = event.ts;
  taskStates.set(event.taskId, { ...state });

  const taskListenersForTask = taskListeners.get(event.taskId);
  if (taskListenersForTask) {
    for (const listener of taskListenersForTask) {
      try {
        listener({ ...state });
      } catch (error) {
        log.warn?.('[containers] task listener failure', error);
      }
    }
  }
}

function ensureSubscribed() {
  if (subscribed) return;
  const api = (window as any).electronAPI;
  if (!api?.onRunEvent) return;
  subscribed = true;
  try {
    unsubscribe = api.onRunEvent((event: RunnerEvent) => {
      log.info('[containers] runner event', event);
      try {
        updateTaskState(event);
      } catch (error) {
        log.error('[containers] failed to update task state', error);
      }
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          log.warn?.('[containers] listener failure', error);
        }
      }
    });
  } catch (error) {
    log.error('[containers] failed to subscribe to run events', error);
    subscribed = false;
    unsubscribe = undefined;
  }
}

export function subscribeToContainerRuns(listener: Listener): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeToTaskRunState(taskId: string, listener: TaskListener): () => void {
  ensureSubscribed();
  const set = taskListeners.get(taskId) ?? new Set<TaskListener>();
  set.add(listener);
  taskListeners.set(taskId, set);
  const current = taskStates.get(taskId);
  if (current) {
    try {
      listener({ ...current });
    } catch (error) {
      log.warn?.('[containers] task listener init failure', error);
    }
  }

  return () => {
    const listenersForTask = taskListeners.get(taskId);
    if (!listenersForTask) return;
    listenersForTask.delete(listener);
    if (listenersForTask.size === 0) {
      taskListeners.delete(taskId);
    }
  };
}

export function getContainerRunState(taskId: string): ContainerRunState | undefined {
  const state = taskStates.get(taskId);
  return state ? { ...state } : undefined;
}

export async function startContainerRun(args: StartRunArgs) {
  ensureSubscribed();
  const api = (window as any).electronAPI;
  const taskId = clean(args.taskId);
  const taskPath = clean(args.taskPath);
  const runId = clean(args.runId);
  const mode = args.mode;
  const payload: Record<string, any> = {};
  if (taskId) payload.taskId = taskId;
  if (taskPath) payload.taskPath = taskPath;
  if (runId) payload.runId = runId;
  if (mode === 'container' || mode === 'host') payload.mode = mode;

  if (!taskId || !taskPath) {
    throw new Error('taskId and taskPath are required to start a container run');
  }

  if (!api || typeof api.startContainerRun !== 'function') {
    throw new Error('Electron bridge not available: startContainerRun');
  }
  try {
    // Basic client-side trace for debugging
    log.info?.('[containers] invoking startContainerRun', payload);
    const res = await api.startContainerRun(payload);
    log.info?.('[containers] startContainerRun response', res);
    return res;
  } catch (error) {
    log.error?.('[containers] startContainerRun failed', error);
    throw error;
  }
}

export function resetContainerRunListeners() {
  const api = (window as any).electronAPI;
  try {
    api?.removeRunEventListeners?.();
  } catch (error) {
    log.warn?.('[containers] failed to remove existing run event listeners', error);
  }
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch {}
  }
  listeners.clear();
  taskListeners.clear();
  taskStates.clear();
  subscribed = false;
  unsubscribe = undefined;
}

export function getAllRunStates(): ContainerRunState[] {
  return Array.from(taskStates.values()).map((s) => ({ ...s }));
}

export function subscribeToAllRunStates(
  listener: (states: ContainerRunState[]) => void
): () => void {
  ensureSubscribed();
  // Emit current snapshot immediately
  try {
    listener(getAllRunStates());
  } catch {}
  // Reuse the event bus to push snapshots on any update
  const off = subscribeToContainerRuns(() => {
    try {
      listener(getAllRunStates());
    } catch {}
  });
  return () => off();
}

/**
 * Inspect any existing compose stack for this task and hydrate local state,
 * so UI shows ports/running status after a window refresh.
 */
export async function refreshTaskRunState(taskId: string) {
  ensureSubscribed();
  const api = (window as any).electronAPI;
  if (!api?.inspectContainerRun) return;
  try {
    const res = await api.inspectContainerRun(taskId);
    if (!res?.ok) return;
    const now = Date.now();
    if (res.running && Array.isArray(res.ports) && res.ports.length > 0) {
      const runId = `resume_${now}`;
      const portsEvent: RunnerEvent = {
        ts: now,
        taskId,
        runId,
        mode: 'container',
        type: 'ports',
        previewService: res.previewService ?? res.ports[0]?.service ?? 'app',
        ports: res.ports.map((p: any) => ({
          ...p,
          protocol: 'tcp',
          url: `http://localhost:${p.host}`,
        })),
      } as any;
      updateTaskState(portsEvent);
      const lifecycleEvent: RunnerEvent = {
        ts: now,
        taskId,
        runId,
        mode: 'container',
        type: 'lifecycle',
        status: 'ready',
      } as any;
      updateTaskState(lifecycleEvent);
    }
  } catch (error) {
    log.warn?.('[containers] refresh run state failed', error);
  }
}

export interface ContainerRunState {
  taskId: string;
  runId?: string;
  status: RunnerLifecycleStatus | 'idle';
  containerId?: string;
  ports: Array<RunnerPortMapping & { url: string }>;
  previewService?: string;
  previewUrl?: string;
  lastUpdatedAt: number;
  lastError: { code: string; message: string } | null;
}
