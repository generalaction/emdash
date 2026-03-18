import { useCallback, useMemo, useState } from 'react';
import type { GitChange } from '@shared/git';

export type SelectionState = 'all' | 'none' | 'partial';

export interface UseSelectionReturn {
  /** Paths currently selected, filtered to only items still in the list. */
  selectedPaths: Set<string>;
  /** 'all' when every item is selected, 'none' when none are, 'partial' otherwise. */
  selectionState: SelectionState;
  isSelected: (path: string) => boolean;
  toggleItem: (path: string) => void;
  /** Selects all when state is 'none' or 'partial', clears all when state is 'all'. */
  toggleAll: () => void;
  clear: () => void;
}

export function useSelection(items: GitChange[]): UseSelectionReturn {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Derive active paths from the current item list
  const activePaths = useMemo(() => new Set(items.map((c) => c.path)), [items]);

  // Automatically drops selections for items that have left the list
  const effectiveSelected = useMemo(
    () => new Set([...selectedPaths].filter((p) => activePaths.has(p))),
    [selectedPaths, activePaths]
  );

  const selectionState: SelectionState = useMemo(() => {
    if (items.length === 0 || effectiveSelected.size === 0) return 'none';
    if (effectiveSelected.size === items.length) return 'all';
    return 'partial';
  }, [effectiveSelected.size, items.length]);

  const isSelected = useCallback(
    (path: string) => effectiveSelected.has(path),
    [effectiveSelected]
  );

  const toggleItem = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectionState === 'all') {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(items.map((c) => c.path)));
    }
  }, [selectionState, items]);

  const clear = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  return {
    selectedPaths: effectiveSelected,
    selectionState,
    isSelected,
    toggleItem,
    toggleAll,
    clear,
  };
}
