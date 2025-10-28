import { useMemo, useSyncExternalStore } from 'react';

type WorkspaceTerminal = {
  id: string;
  title: string;
  cwd?: string;
  shell?: string;
  createdAt: number;
};

type WorkspaceTerminalsState = {
  terminals: WorkspaceTerminal[];
  activeId: string | null;
  counter: number;
};

type WorkspaceSnapshot = {
  terminals: WorkspaceTerminal[];
  activeTerminalId: string | null;
};

const STORAGE_PREFIX = 'emdash:workspaceTerminals:v1';

const workspaceStates = new Map<string, WorkspaceTerminalsState>();
const workspaceListeners = new Map<string, Set<() => void>>();
const workspaceSnapshots = new Map<string, WorkspaceSnapshot>();

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  terminals: [],
  activeTerminalId: null,
};

const storageAvailable = (() => {
  if (typeof window === 'undefined') return false;
  try {
    const key = '__emdash_terminal_test__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
})();

function storageKey(workspaceId: string) {
  return `${STORAGE_PREFIX}:${workspaceId}`;
}

function cloneState(state: WorkspaceTerminalsState): WorkspaceTerminalsState {
  return {
    terminals: state.terminals.map((terminal) => ({ ...terminal })),
    activeId: state.activeId,
    counter: state.counter,
  };
}

function loadFromStorage(workspaceId: string): WorkspaceTerminalsState | null {
  if (!storageAvailable) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const terminals = Array.isArray(parsed.terminals)
      ? parsed.terminals
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const id = typeof item.id === 'string' && item.id ? item.id : null;
            const title = typeof item.title === 'string' && item.title ? item.title : null;
            if (!id || !title) return null;
            return {
              id,
              title,
              cwd: typeof item.cwd === 'string' && item.cwd ? item.cwd : undefined,
              shell: typeof item.shell === 'string' && item.shell ? item.shell : undefined,
              createdAt:
                typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
                  ? item.createdAt
                  : Date.now(),
            } satisfies WorkspaceTerminal;
          })
          .filter(Boolean)
      : [];

    const counter =
      typeof parsed.counter === 'number' && Number.isFinite(parsed.counter)
        ? Math.max(parsed.counter, terminals.length)
        : terminals.length;

    let activeId: string | null = null;
    if (typeof parsed.activeId === 'string' && parsed.activeId) {
      activeId = terminals.some((terminal) => terminal.id === parsed.activeId)
        ? parsed.activeId
        : terminals[0]?.id ?? null;
    } else {
      activeId = terminals[0]?.id ?? null;
    }

    if (!terminals.length) return null;

    return {
      terminals,
      activeId,
      counter,
    };
  } catch {
    return null;
  }
}

function saveToStorage(workspaceId: string, state: WorkspaceTerminalsState) {
  if (!storageAvailable) return;
  try {
    const payload = JSON.stringify({
      terminals: state.terminals,
      activeId: state.activeId,
      counter: state.counter,
    });
    window.localStorage.setItem(storageKey(workspaceId), payload);
  } catch {
    // ignore storage errors
  }
}

function makeTerminalId(workspaceId: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${workspaceId}::term::${Date.now().toString(16)}::${rnd}`;
}

function createDefaultState(workspaceId: string, workspacePath?: string): WorkspaceTerminalsState {
  const terminalId = makeTerminalId(workspaceId);
  const firstTerminal: WorkspaceTerminal = {
    id: terminalId,
    title: 'Terminal 1',
    cwd: workspacePath,
    createdAt: Date.now(),
  };
  return {
    terminals: [firstTerminal],
    activeId: terminalId,
    counter: 1,
  };
}

function ensureSnapshot(workspaceId: string, state: WorkspaceTerminalsState) {
  const current = workspaceSnapshots.get(workspaceId);
  if (
    !current ||
    current.terminals !== state.terminals ||
    current.activeTerminalId !== state.activeId
  ) {
    workspaceSnapshots.set(workspaceId, {
      terminals: state.terminals,
      activeTerminalId: state.activeId,
    });
  }
  return workspaceSnapshots.get(workspaceId)!;
}

function ensureWorkspaceState(workspaceId: string, workspacePath?: string): WorkspaceTerminalsState {
  let state = workspaceStates.get(workspaceId);
  if (state) {
    ensureSnapshot(workspaceId, state);
    return state;
  }

  state = loadFromStorage(workspaceId) ?? createDefaultState(workspaceId, workspacePath);
  workspaceStates.set(workspaceId, state);
  ensureSnapshot(workspaceId, state);
  return state;
}

function emit(workspaceId: string) {
  const listeners = workspaceListeners.get(workspaceId);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function updateWorkspaceState(
  workspaceId: string,
  workspacePath: string | undefined,
  mutate: (draft: WorkspaceTerminalsState) => void
) {
  const current = ensureWorkspaceState(workspaceId, workspacePath);
  const draft = cloneState(current);
  mutate(draft);
  // Ensure state remains valid
  if (!draft.terminals.length) {
    const fallback = createDefaultState(workspaceId, workspacePath);
    workspaceStates.set(workspaceId, fallback);
    ensureSnapshot(workspaceId, fallback);
    saveToStorage(workspaceId, fallback);
    emit(workspaceId);
    return;
  }
  if (typeof draft.activeId !== 'string' || !draft.terminals.some((t) => t.id === draft.activeId)) {
    draft.activeId = draft.terminals[0].id;
  }
  draft.counter = Math.max(draft.counter, draft.terminals.length);
  workspaceStates.set(workspaceId, draft);
  ensureSnapshot(workspaceId, draft);
  saveToStorage(workspaceId, draft);
  emit(workspaceId);
}

function getSnapshot(workspaceId: string | null, workspacePath?: string): WorkspaceSnapshot {
  if (!workspaceId) return EMPTY_SNAPSHOT;
  const state = ensureWorkspaceState(workspaceId, workspacePath);
  return ensureSnapshot(workspaceId, state);
}

function subscribe(
  workspaceId: string | null,
  workspacePath: string | undefined,
  listener: () => void
): () => void {
  if (!workspaceId) {
    return () => undefined;
  }
  ensureWorkspaceState(workspaceId, workspacePath);
  let set = workspaceListeners.get(workspaceId);
  if (!set) {
    set = new Set();
    workspaceListeners.set(workspaceId, set);
  }
  set.add(listener);
  return () => {
    const listeners = workspaceListeners.get(workspaceId);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) {
      workspaceListeners.delete(workspaceId);
    }
  };
}

function createTerminal(workspaceId: string, workspacePath?: string) {
  updateWorkspaceState(workspaceId, workspacePath, (draft) => {
    const nextIndex = draft.counter + 1;
    const id = makeTerminalId(workspaceId);
    draft.counter = nextIndex;
    draft.activeId = id;
    draft.terminals = [
      ...draft.terminals,
      {
        id,
        title: `Terminal ${nextIndex}`,
        cwd: workspacePath,
        createdAt: Date.now(),
      },
    ];
  });
}

function setActive(workspaceId: string, terminalId: string, workspacePath?: string) {
  updateWorkspaceState(workspaceId, workspacePath, (draft) => {
    if (draft.terminals.some((terminal) => terminal.id === terminalId)) {
      draft.activeId = terminalId;
    }
  });
}

function closeTerminal(workspaceId: string, terminalId: string, workspacePath?: string) {
  const state = ensureWorkspaceState(workspaceId, workspacePath);
  if (state.terminals.length <= 1) {
    return;
  }
  const exists = state.terminals.some((terminal) => terminal.id === terminalId);
  if (!exists) return;

  updateWorkspaceState(workspaceId, workspacePath, (draft) => {
    const idx = draft.terminals.findIndex((terminal) => terminal.id === terminalId);
    draft.terminals = draft.terminals.filter((terminal) => terminal.id !== terminalId);
    if (draft.activeId === terminalId) {
      const fallback = draft.terminals[idx] ?? draft.terminals[idx - 1] ?? draft.terminals[0];
      draft.activeId = fallback?.id ?? null;
    }
  });

  try {
    const api: any = (window as any).electronAPI;
    api?.ptyKill?.(terminalId);
  } catch {
    // ignore kill errors
  }
}

export function useWorkspaceTerminals(workspaceId: string | null, workspacePath?: string) {
  const snapshot = useSyncExternalStore(
    (listener) => subscribe(workspaceId, workspacePath, listener),
    () => getSnapshot(workspaceId, workspacePath),
    () => getSnapshot(workspaceId, workspacePath)
  );

  const actions = useMemo(() => {
    if (!workspaceId) {
      return {
        createTerminal: () => undefined,
        setActiveTerminal: (_terminalId: string) => undefined,
        closeTerminal: (_terminalId: string) => undefined,
      };
    }
    return {
      createTerminal: () => createTerminal(workspaceId, workspacePath),
      setActiveTerminal: (terminalId: string) => setActive(workspaceId, terminalId, workspacePath),
      closeTerminal: (terminalId: string) => closeTerminal(workspaceId, terminalId, workspacePath),
    };
  }, [workspaceId, workspacePath]);

  const activeTerminal =
    snapshot.terminals.find((terminal) => terminal.id === snapshot.activeTerminalId) ?? null;

  return {
    terminals: snapshot.terminals,
    activeTerminalId: snapshot.activeTerminalId,
    activeTerminal,
    ...actions,
  };
}

export type { WorkspaceTerminal };
