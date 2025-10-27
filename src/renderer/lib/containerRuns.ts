import type { RunnerEvent, RunnerMode } from '@shared/container';
import { log } from './logger';

type Listener = (event: RunnerEvent) => void;

interface StartRunArgs {
  workspaceId: string;
  workspacePath: string;
  runId?: string;
  mode?: RunnerMode;
}

const listeners = new Set<Listener>();
let subscribed = false;
let unsubscribe: (() => void) | undefined;

function clean(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function ensureSubscribed() {
  if (subscribed) return;
  const api = (window as any).electronAPI;
  if (!api?.onRunEvent) return;
  subscribed = true;
  try {
    unsubscribe = api.onRunEvent((event: RunnerEvent) => {
      log.info('[containers] runner event', event);
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

  return api?.startContainerRun?.(payload);
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
  subscribed = false;
  unsubscribe = undefined;
}
