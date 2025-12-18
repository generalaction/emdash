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
import type { ContainerRunState } from '../types/container';
import { log } from './logger';

type Listener = (event: RunnerEvent) => void;
type WorkspaceListener = (state: ContainerRunState) => void;

interface StartRunArgs {
  workspaceId: string;
  workspacePath: string;
  runId?: string;
  mode?: RunnerMode;
}

const listeners = new Set<Listener>();
const workspaceListeners = new Map<string, Set<WorkspaceListener>>();
const workspaceStates = new Map<string, ContainerRunState>();
let subscribed = false;
let unsubscribe: (() => void) | undefined;

function clean(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function getOrCreateState(workspaceId: string): ContainerRunState {
  const existing = workspaceStates.get(workspaceId);
  if (existing) return existing;
  const created: ContainerRunState = {
    workspaceId,
    runId: undefined,
    status: 'idle',
    containerId: undefined,
    ports: [],
    previewService: undefined,
    previewUrl: undefined,
    lastUpdatedAt: 0,
    lastError: null,
  };
  workspaceStates.set(workspaceId, created);
  return created;
}

function clonePort(port: RunnerPortMapping): RunnerPortMapping & { url: string } {
  const url = port.url ?? `http://localhost:${port.host}`;
  return { ...port, url };
}

function updateWorkspaceState(event: RunnerEvent) {
  const state = getOrCreateState(event.workspaceId);
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
  workspaceStates.set(event.workspaceId, { ...state });

  const wsListeners = workspaceListeners.get(event.workspaceId);
  if (wsListeners) {
    for (const listener of wsListeners) {
      try {
        listener({ ...state });
      } catch (error) {
        log.warn?.('[containers] workspace listener failure', error);
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
        updateWorkspaceState(event);
      } catch (error) {
        log.error('[containers] failed to update workspace state', error);
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

export function subscribeToWorkspaceRunState(
  workspaceId: string,
  listener: WorkspaceListener
): () => void {
  ensureSubscribed();
  const set = workspaceListeners.get(workspaceId) ?? new Set<WorkspaceListener>();
  set.add(listener);
  workspaceListeners.set(workspaceId, set);
  const current = workspaceStates.get(workspaceId);
  if (current) {
    try {
      listener({ ...current });
    } catch (error) {
      log.warn?.('[containers] workspace listener init failure', error);
    }
  }

  return () => {
    const listenersForWorkspace = workspaceListeners.get(workspaceId);
    if (!listenersForWorkspace) return;
    listenersForWorkspace.delete(listener);
    if (listenersForWorkspace.size === 0) {
      workspaceListeners.delete(workspaceId);
    }
  };
}

export function getContainerRunState(workspaceId: string): ContainerRunState | undefined {
  const state = workspaceStates.get(workspaceId);
  return state ? { ...state } : undefined;
}

export async function startContainerRun(args: StartRunArgs) {
  ensureSubscribed();
  const api = (window as any).electronAPI;
  const workspaceId = clean(args.workspaceId);
  const workspacePath = clean(args.workspacePath);
  const runId = clean(args.runId);
  const mode = args.mode;
  const payload: Record<string, any> = {};
  if (workspaceId) payload.workspaceId = workspaceId;
  if (workspacePath) payload.workspacePath = workspacePath;
  if (runId) payload.runId = runId;
  if (mode === 'container' || mode === 'host') payload.mode = mode;

  if (!workspaceId || !workspacePath) {
    throw new Error('workspaceId and workspacePath are required to start a container run');
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
  workspaceListeners.clear();
  workspaceStates.clear();
  subscribed = false;
  unsubscribe = undefined;
}

export function getAllRunStates(): ContainerRunState[] {
  return Array.from(workspaceStates.values()).map((s) => ({ ...s }));
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
 * Inspect any existing compose stack for this workspace and hydrate local state,
 * so UI shows ports/running status after a window refresh.
 */
export async function refreshWorkspaceRunState(workspaceId: string) {
  ensureSubscribed();
  const api = (window as any).electronAPI;
  if (!api?.inspectContainerRun) return;
  try {
    const res = await api.inspectContainerRun(workspaceId);
    if (!res?.ok) return;
    const now = Date.now();
    if (res.running && Array.isArray(res.ports) && res.ports.length > 0) {
      const runId = `resume_${now}`;
      const portsEvent: RunnerEvent = {
        ts: now,
        workspaceId,
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
      updateWorkspaceState(portsEvent);
      const lifecycleEvent: RunnerEvent = {
        ts: now,
        workspaceId,
        runId,
        mode: 'container',
        type: 'lifecycle',
        status: 'ready',
      } as any;
      updateWorkspaceState(lifecycleEvent);
    }
  } catch (error) {
    log.warn?.('[containers] refresh run state failed', error);
  }
}

export type { ContainerRunState } from '../types/container';
