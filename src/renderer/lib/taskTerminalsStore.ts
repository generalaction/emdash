import { useMemo, useSyncExternalStore } from 'react';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';

type TaskTerminal = {
  id: string;
  title: string;
  cwd?: string;
  shell?: string;
  createdAt: number;
};

type TaskTerminalsState = {
  terminals: TaskTerminal[];
  activeId: string | null;
  counter: number;
};

type TaskSnapshot = {
  terminals: TaskTerminal[];
  activeTerminalId: string | null;
};

const STORAGE_PREFIX = 'emdash:taskTerminals:v1';

const taskStates = new Map<string, TaskTerminalsState>();
const taskListeners = new Map<string, Set<() => void>>();
const taskSnapshots = new Map<string, TaskSnapshot>();

const EMPTY_SNAPSHOT: TaskSnapshot = {
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

function storageKey(taskId: string) {
  return `${STORAGE_PREFIX}:${taskId}`;
}

function cloneState(state: TaskTerminalsState): TaskTerminalsState {
  return {
    terminals: state.terminals.map((terminal) => ({ ...terminal })),
    activeId: state.activeId,
    counter: state.counter,
  };
}

function loadFromStorage(taskId: string): TaskTerminalsState | null {
  if (!storageAvailable) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const terminals = Array.isArray(parsed.terminals)
      ? parsed.terminals
          .map((item: any) => {
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
            } satisfies TaskTerminal;
          })
          .filter((x: TaskTerminal | null): x is TaskTerminal => Boolean(x))
      : [];

    const counter =
      typeof parsed.counter === 'number' && Number.isFinite(parsed.counter)
        ? Math.max(parsed.counter, terminals.length)
        : terminals.length;

    let activeId: string | null = null;
    if (typeof parsed.activeId === 'string' && parsed.activeId) {
      activeId = terminals.some((terminal: TaskTerminal) => terminal.id === parsed.activeId)
        ? parsed.activeId
        : (terminals[0]?.id ?? null);
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

function saveToStorage(taskId: string, state: TaskTerminalsState) {
  if (!storageAvailable) return;
  try {
    const payload = JSON.stringify({
      terminals: state.terminals,
      activeId: state.activeId,
      counter: state.counter,
    });
    window.localStorage.setItem(storageKey(taskId), payload);
  } catch {
    // ignore storage errors
  }
}

function makeTerminalId(taskId: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${taskId}::term::${Date.now().toString(16)}::${rnd}`;
}

function createDefaultState(taskId: string, taskPath?: string): TaskTerminalsState {
  const terminalId = makeTerminalId(taskId);
  const firstTerminal: TaskTerminal = {
    id: terminalId,
    title: 'Terminal 1',
    cwd: taskPath,
    createdAt: Date.now(),
  };
  return {
    terminals: [firstTerminal],
    activeId: terminalId,
    counter: 1,
  };
}

function ensureSnapshot(taskId: string, state: TaskTerminalsState) {
  const current = taskSnapshots.get(taskId);
  if (
    !current ||
    current.terminals !== state.terminals ||
    current.activeTerminalId !== state.activeId
  ) {
    taskSnapshots.set(taskId, {
      terminals: state.terminals,
      activeTerminalId: state.activeId,
    });
  }
  return taskSnapshots.get(taskId)!;
}

function ensureTaskState(taskId: string, taskPath?: string): TaskTerminalsState {
  let state = taskStates.get(taskId);
  if (state) {
    ensureSnapshot(taskId, state);
    return state;
  }

  state = loadFromStorage(taskId) ?? createDefaultState(taskId, taskPath);
  taskStates.set(taskId, state);
  ensureSnapshot(taskId, state);
  return state;
}

function emit(taskId: string) {
  const listeners = taskListeners.get(taskId);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function updateTaskState(
  taskId: string,
  taskPath: string | undefined,
  mutate: (draft: TaskTerminalsState) => void
) {
  const current = ensureTaskState(taskId, taskPath);
  const draft = cloneState(current);
  mutate(draft);
  // Ensure state remains valid
  if (!draft.terminals.length) {
    const fallback = createDefaultState(taskId, taskPath);
    taskStates.set(taskId, fallback);
    ensureSnapshot(taskId, fallback);
    saveToStorage(taskId, fallback);
    emit(taskId);
    return;
  }
  if (typeof draft.activeId !== 'string' || !draft.terminals.some((t) => t.id === draft.activeId)) {
    draft.activeId = draft.terminals[0].id;
  }
  draft.counter = Math.max(draft.counter, draft.terminals.length);
  taskStates.set(taskId, draft);
  ensureSnapshot(taskId, draft);
  saveToStorage(taskId, draft);
  emit(taskId);
}

function getSnapshot(taskId: string | null, taskPath?: string): TaskSnapshot {
  if (!taskId) return EMPTY_SNAPSHOT;
  const state = ensureTaskState(taskId, taskPath);
  return ensureSnapshot(taskId, state);
}

function subscribe(
  taskId: string | null,
  taskPath: string | undefined,
  listener: () => void
): () => void {
  const id = taskId || 'global';
  ensureTaskState(id, taskPath);
  let set = taskListeners.get(id);
  if (!set) {
    set = new Set();
    taskListeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const listeners = taskListeners.get(id);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) {
      taskListeners.delete(id);
    }
  };
}

function createTerminal(
  taskId: string,
  taskPath?: string,
  options?: { title?: string; cwd?: string }
) {
  updateTaskState(taskId, taskPath, (draft) => {
    const nextIndex = draft.counter + 1;
    const id = makeTerminalId(taskId);
    draft.counter = nextIndex;
    draft.activeId = id;
    draft.terminals = [
      ...draft.terminals,
      {
        id,
        title: options?.title || `Terminal ${nextIndex}`,
        cwd: options?.cwd || taskPath,
        createdAt: Date.now(),
      },
    ];
  });
}

function setActive(taskId: string, terminalId: string, taskPath?: string) {
  updateTaskState(taskId, taskPath, (draft) => {
    if (draft.terminals.some((terminal) => terminal.id === terminalId)) {
      draft.activeId = terminalId;
    }
  });
}

function closeTerminal(taskId: string, terminalId: string, taskPath?: string) {
  const state = ensureTaskState(taskId, taskPath);
  if (state.terminals.length <= 1) {
    return;
  }
  const exists = state.terminals.some((terminal) => terminal.id === terminalId);
  if (!exists) return;

  updateTaskState(taskId, taskPath, (draft) => {
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

export function disposeTaskTerminals(taskKey: string): void {
  const state = taskStates.get(taskKey) ?? loadFromStorage(taskKey);
  if (state) {
    for (const terminal of state.terminals) {
      try {
        (window as any).electronAPI?.ptyKill?.(terminal.id);
      } catch {
        // ignore kill errors
      }
      try {
        terminalSessionRegistry.dispose(terminal.id);
      } catch {
        // ignore dispose errors
      }
      try {
        (window as any).electronAPI?.ptyClearSnapshot?.({ id: terminal.id });
      } catch {
        // ignore snapshot errors
      }
    }
  }

  taskStates.delete(taskKey);
  taskSnapshots.delete(taskKey);
  taskListeners.delete(taskKey);

  if (storageAvailable) {
    try {
      window.localStorage.removeItem(storageKey(taskKey));
    } catch {
      // ignore storage errors
    }
  }
}

export function useTaskTerminals(
  taskId: string | null,
  taskPath?: string,
  opts?: { defaultCwd?: string }
) {
  const resolvedId = taskId || 'global';
  const resolvedPath = taskPath || opts?.defaultCwd;
  const snapshot = useSyncExternalStore(
    (listener) => subscribe(resolvedId, resolvedPath, listener),
    () => getSnapshot(resolvedId, resolvedPath),
    () => getSnapshot(resolvedId, resolvedPath)
  );

  const actions = useMemo(() => {
    return {
      createTerminal: (options?: { title?: string; cwd?: string }) =>
        createTerminal(resolvedId, options?.cwd || resolvedPath, options),
      setActiveTerminal: (terminalId: string) => setActive(resolvedId, terminalId, resolvedPath),
      closeTerminal: (terminalId: string) => closeTerminal(resolvedId, terminalId, resolvedPath),
    };
  }, [resolvedId, resolvedPath]);

  const activeTerminal =
    snapshot.terminals.find((terminal) => terminal.id === snapshot.activeTerminalId) ?? null;

  return {
    terminals: snapshot.terminals,
    activeTerminalId: snapshot.activeTerminalId,
    activeTerminal,
    ...actions,
  };
}

export type { TaskTerminal };
