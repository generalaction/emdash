// Lightweight derived status store for tasks based on agent activity
// - Derives 'busy' when we receive stream output for a task
// - Derives 'idle' after a short inactivity window or when a 'complete' event fires

type Derived = 'idle' | 'busy';
import { subscribeToTaskRunState } from './containerRuns';
import { activityStore } from './activityStore';

type Listener = (status: Derived) => void;

const statusByTask = new Map<string, Derived>();
const listenersByTask = new Map<string, Set<Listener>>();
const lastActivity = new Map<string, number>();

// Inactivity delay before flipping back to idle
const IDLE_AFTER_MS = 12_000;
let tickStarted = false;

function ensureTicker() {
  if (tickStarted) return;
  tickStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [tid, ts] of lastActivity.entries()) {
      const cur = statusByTask.get(tid) || 'idle';
      if (cur === 'busy' && now - ts > IDLE_AFTER_MS) {
        setStatusInternal(tid, 'idle');
      }
    }
  }, 2_000);
}

function setStatusInternal(taskId: string, next: Derived) {
  const prev = statusByTask.get(taskId) || 'idle';
  if (prev === next) return;
  statusByTask.set(taskId, next);
  const ls = listenersByTask.get(taskId);
  if (ls)
    for (const fn of Array.from(ls)) {
      try {
        fn(next);
      } catch {}
    }
}

// Wire global event listeners once
let wired = false;
function wireGlobal() {
  if (wired) return;
  wired = true;
  ensureTicker();
  const api: any = (window as any).electronAPI;
  // Agent streams removed; PTY and container activity drive status.
}

export function getDerivedStatus(taskId: string): Derived {
  wireGlobal();
  return statusByTask.get(taskId) || 'idle';
}

export function subscribeDerivedStatus(taskId: string, listener: Listener): () => void {
  wireGlobal();
  let set = listenersByTask.get(taskId);
  if (!set) {
    set = new Set<Listener>();
    listenersByTask.set(taskId, set);
  }
  set.add(listener);
  // Emit current immediately
  try {
    listener(getDerivedStatus(taskId));
  } catch {}
  return () => {
    const set2 = listenersByTask.get(taskId);
    if (!set2) return;
    set2.delete(listener);
    if (set2.size === 0) listenersByTask.delete(taskId);
  };
}

// Observe PTY activity (all current providers emit via PTY).
// Call once per task to ensure terminal output marks the task busy.
// Kept as a separate watcher so future non‑PTY providers can remain decoupled.
const ptyUnsubs = new Map<string, () => void>();
export function watchTaskPty(taskId: string): () => void {
  wireGlobal();
  if (ptyUnsubs.has(taskId)) return ptyUnsubs.get(taskId)!;
  const api: any = (window as any).electronAPI;
  let off: (() => void) | null = null;
  let offExit: (() => void) | null = null;
  let offStarted: (() => void) | null = null;
  try {
    off = api?.onPtyData?.(taskId, (_chunk: string) => {
      lastActivity.set(taskId, Date.now());
      setStatusInternal(taskId, 'busy');
    });
  } catch {}
  try {
    offStarted = api?.onPtyStarted?.((payload: { id: string }) => {
      if (payload?.id !== taskId) return;
      lastActivity.set(taskId, Date.now());
      setStatusInternal(taskId, 'busy');
    });
  } catch {}
  try {
    offExit = api?.onPtyExit?.(taskId, () => {
      lastActivity.set(taskId, Date.now());
      setStatusInternal(taskId, 'idle');
    });
  } catch {}
  const cleanup = () => {
    try {
      off?.();
    } catch {}
    try {
      offExit?.();
    } catch {}
    try {
      offStarted?.();
    } catch {}
    ptyUnsubs.delete(taskId);
  };
  ptyUnsubs.set(taskId, cleanup);
  return cleanup;
}

// Container runs also imply task activity (build/start/ready)
export function watchTaskContainers(taskId: string): () => void {
  wireGlobal();
  const off = subscribeToTaskRunState(taskId, (state) => {
    const s = String(state?.status || 'idle');
    const active = /^(starting|building|running|ready)$/i.test(s);
    lastActivity.set(taskId, Date.now());
    setStatusInternal(taskId, active ? 'busy' : 'idle');
  });
  return off;
}

// Align with the app's activity indicator (left sidebar).
// Subscribes to the shared activityStore which understands provider-specific PTY IDs
// and classifies chunks as busy/idle with debouncing.
export function watchTaskActivity(taskId: string): () => void {
  wireGlobal();
  const off = activityStore.subscribe(taskId, (isBusy) => {
    lastActivity.set(taskId, Date.now());
    setStatusInternal(taskId, isBusy ? 'busy' : 'idle');
  });
  return off;
}
