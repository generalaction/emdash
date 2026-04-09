import { useCallback, useEffect, useRef, useState } from 'react';

type SelectedMode = 'task' | 'global' | 'lifecycle';
type LifecyclePhase = 'setup' | 'run' | 'teardown';

interface TerminalStore {
  terminals: { id: string }[];
  activeTerminalId: string | null;
  setActiveTerminal: (terminalId: string) => void;
}

interface UseTerminalSelectionOptions {
  task: { id: string } | null;
  taskTerminals: TerminalStore;
  globalTerminals: TerminalStore;
}

export interface TerminalSelection {
  value: string;
  parsed: { mode: SelectedMode; id: string } | null;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  onChange: (value: string) => void;
  onCreateTerminal: (mode: 'task' | 'global', id: string) => void;
  activeTerminalId: string | null;
  selectedLifecycle: LifecyclePhase | null;
}

export function parseTerminalValue(value: string): { mode: SelectedMode; id: string } | null {
  const match = value.match(/^(task|global|lifecycle)::(.+)$/);
  if (!match) return null;
  return { mode: match[1] as SelectedMode, id: match[2] };
}

/**
 * Pure function that determines what the selection should be, given current state.
 * Returns the new value string, or null if no change is needed.
 */
export function resolveSelection(params: {
  currentValue: string;
  taskId: string | null;
  prevTaskId: string | null;
  taskTerminals: { terminals: { id: string }[]; activeTerminalId: string | null };
  globalTerminals: { terminals: { id: string }[]; activeTerminalId: string | null };
}): string | null {
  const { currentValue, taskId, prevTaskId, taskTerminals, globalTerminals } = params;

  // 1. Task switch — always reset to worktree 1
  if (taskId !== prevTaskId) {
    if (taskTerminals.terminals.length > 0) {
      return `task::${taskTerminals.terminals[0].id}`;
    }
    if (globalTerminals.terminals.length > 0) {
      return `global::${globalTerminals.terminals[0].id}`;
    }
    return '';
  }

  // 2. No selection — pick first available
  if (!currentValue) {
    if (taskTerminals.terminals.length > 0) {
      return `task::${taskTerminals.terminals[0].id}`;
    }
    if (globalTerminals.terminals.length > 0) {
      return `global::${globalTerminals.terminals[0].id}`;
    }
    return '';
  }

  const parsed = parseTerminalValue(currentValue);
  if (!parsed) return '';

  // 3. No task but mode is task — switch to global
  if (!taskId && parsed.mode === 'task') {
    if (globalTerminals.terminals.length > 0) {
      return `global::${globalTerminals.terminals[0].id}`;
    }
    return '';
  }

  // 4. Lifecycle mode — don't interfere
  if (parsed.mode === 'lifecycle') return null;

  // 5. Selected terminal still exists — no change needed
  const terminals = parsed.mode === 'task' ? taskTerminals.terminals : globalTerminals.terminals;
  const exists = terminals.some((t) => t.id === parsed.id);
  if (exists) return null;

  // 6. Terminal gone (deleted) — stay in same type if possible
  const sameTypeStore = parsed.mode === 'task' ? taskTerminals : globalTerminals;
  if (
    sameTypeStore.activeTerminalId &&
    sameTypeStore.terminals.some((t) => t.id === sameTypeStore.activeTerminalId)
  ) {
    return `${parsed.mode}::${sameTypeStore.activeTerminalId}`;
  }

  // Cross-type fallback
  const otherMode = parsed.mode === 'task' ? 'global' : 'task';
  const otherStore = parsed.mode === 'task' ? globalTerminals : taskTerminals;
  if (otherStore.terminals.length > 0) {
    return `${otherMode}::${otherStore.terminals[0].id}`;
  }

  return '';
}

export function useTerminalSelection(options: UseTerminalSelectionOptions): TerminalSelection {
  const { task, taskTerminals, globalTerminals } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string>(() => {
    if (task && taskTerminals.activeTerminalId) {
      return `task::${taskTerminals.activeTerminalId}`;
    }
    if (globalTerminals.activeTerminalId) {
      return `global::${globalTerminals.activeTerminalId}`;
    }
    return '';
  });

  const prevTaskIdRef = useRef<string | null>(task?.id ?? null);

  // Unified validity effect — deps list individual properties to avoid re-runs
  // from unstable object references (useTaskTerminals returns new objects each render).
  useEffect(() => {
    const prevTaskId = prevTaskIdRef.current;
    const newValue = resolveSelection({
      currentValue: selectedValue,
      taskId: task?.id ?? null,
      prevTaskId,
      taskTerminals,
      globalTerminals,
    });

    // Always update the ref after reading it
    prevTaskIdRef.current = task?.id ?? null;

    if (newValue !== null && newValue !== selectedValue) {
      setSelectedValue(newValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    task?.id,
    selectedValue,
    taskTerminals.terminals,
    taskTerminals.activeTerminalId,
    globalTerminals.terminals,
    globalTerminals.activeTerminalId,
  ]);

  const parsed = selectedValue ? parseTerminalValue(selectedValue) : null;

  // Intentionally deps on stable setActiveTerminal methods, not full store objects.
  const onChange = useCallback(
    (value: string) => {
      setSelectedValue(value);
      const p = parseTerminalValue(value);
      if (!p) return;
      if (p.mode === 'task') {
        taskTerminals.setActiveTerminal(p.id);
      } else if (p.mode === 'global') {
        globalTerminals.setActiveTerminal(p.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskTerminals.setActiveTerminal, globalTerminals.setActiveTerminal]
  );

  // Assumes the store's activeId was already set by createTerminal() before this is called.
  const onCreateTerminal = useCallback((mode: 'task' | 'global', id: string) => {
    setSelectedValue(`${mode}::${id}`);
    setIsOpen(false);
  }, []);

  const activeTerminalId = parsed?.mode === 'lifecycle' ? null : (parsed?.id ?? null);
  const selectedLifecycle = parsed?.mode === 'lifecycle' ? (parsed.id as LifecyclePhase) : null;

  return {
    value: selectedValue,
    parsed,
    isOpen,
    setIsOpen,
    onChange,
    onCreateTerminal,
    activeTerminalId,
    selectedLifecycle,
  };
}
