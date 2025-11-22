// Lightweight derived status store for workspaces based on agent activity
// - Derives 'busy' when we receive stream output for a workspace
// - Derives 'idle' after a short inactivity window or when a 'complete' event fires

type Derived = 'idle' | 'busy';
import { subscribeToWorkspaceRunState } from './containerRuns';
import { activityStore } from './activityStore';

type Listener = (status: Derived) => void;

const statusByWorkspace = new Map<string, Derived>();
const listenersByWorkspace = new Map<string, Set<Listener>>();
const lastActivity = new Map<string, number>();

// Inactivity delay before flipping back to idle
const IDLE_AFTER_MS = 12_000;
let tickStarted = false;

function ensureTicker() {
  if (tickStarted) return;
  tickStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [wid, ts] of lastActivity.entries()) {
      const cur = statusByWorkspace.get(wid) || 'idle';
      if (cur === 'busy' && now - ts > IDLE_AFTER_MS) {
        setStatusInternal(wid, 'idle');
      }
    }
  }, 2_000);
}

function setStatusInternal(workspaceId: string, next: Derived) {
  const prev = statusByWorkspace.get(workspaceId) || 'idle';
  if (prev === next) return;
  statusByWorkspace.set(workspaceId, next);
  const ls = listenersByWorkspace.get(workspaceId);
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

export function getDerivedStatus(workspaceId: string): Derived {
  wireGlobal();
  return statusByWorkspace.get(workspaceId) || 'idle';
}

export function subscribeDerivedStatus(workspaceId: string, listener: Listener): () => void {
  wireGlobal();
  let set = listenersByWorkspace.get(workspaceId);
  if (!set) {
    set = new Set<Listener>();
    listenersByWorkspace.set(workspaceId, set);
  }
  set.add(listener);
  // Emit current immediately
  try {
    listener(getDerivedStatus(workspaceId));
  } catch {}
  return () => {
    const set2 = listenersByWorkspace.get(workspaceId);
    if (!set2) return;
    set2.delete(listener);
    if (set2.size === 0) listenersByWorkspace.delete(workspaceId);
  };
}

// Observe PTY activity (all current providers emit via PTY).
// Call once per workspace to ensure terminal output marks the workspace busy.
// Kept as a separate watcher so future non‑PTY providers can remain decoupled.
const ptyUnsubs = new Map<string, () => void>();
export function watchWorkspacePty(workspaceId: string): () => void {
  wireGlobal();
  if (ptyUnsubs.has(workspaceId)) return ptyUnsubs.get(workspaceId)!;
  const api: any = (window as any).electronAPI;
  let off: (() => void) | null = null;
  let offExit: (() => void) | null = null;
  let offStarted: (() => void) | null = null;
  try {
    off = api?.onPtyData?.(workspaceId, (_chunk: string) => {
      lastActivity.set(workspaceId, Date.now());
      setStatusInternal(workspaceId, 'busy');
    });
  } catch {}
  try {
    offStarted = api?.onPtyStarted?.((payload: { id: string }) => {
      if (payload?.id !== workspaceId) return;
      lastActivity.set(workspaceId, Date.now());
      setStatusInternal(workspaceId, 'busy');
    });
  } catch {}
  try {
    offExit = api?.onPtyExit?.(workspaceId, () => {
      lastActivity.set(workspaceId, Date.now());
      setStatusInternal(workspaceId, 'idle');
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
    ptyUnsubs.delete(workspaceId);
  };
  ptyUnsubs.set(workspaceId, cleanup);
  return cleanup;
}

// Container runs also imply workspace activity (build/start/ready)
export function watchWorkspaceContainers(workspaceId: string): () => void {
  wireGlobal();
  const off = subscribeToWorkspaceRunState(workspaceId, (state) => {
    const s = String(state?.status || 'idle');
    const active = /^(starting|building|running|ready)$/i.test(s);
    lastActivity.set(workspaceId, Date.now());
    setStatusInternal(workspaceId, active ? 'busy' : 'idle');
  });
  return off;
}

// Align with the app's activity indicator (left sidebar).
// Subscribes to the shared activityStore which understands provider-specific PTY IDs
// and classifies chunks as busy/idle with debouncing.
export function watchWorkspaceActivity(workspaceId: string): () => void {
  wireGlobal();
  const off = activityStore.subscribe(workspaceId, (isBusy) => {
    lastActivity.set(workspaceId, Date.now());
    setStatusInternal(workspaceId, isBusy ? 'busy' : 'idle');
  });
  return off;
}
