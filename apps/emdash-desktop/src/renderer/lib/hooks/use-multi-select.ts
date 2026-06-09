import { useCallback, useMemo, useState } from 'react';

interface UseMultiSelectOptions<T> {
  items: ReadonlyArray<T>;
  getId: (item: T) => string;
}

export interface UseMultiSelectResult {
  selectedIds: Set<string>;
  selectedCount: number;
  selectedOrderedIds: string[];
  toggle: (id: string, options?: { range?: boolean }) => void;
  selectAll: () => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export function useMultiSelect<T>({
  items,
  getId,
}: UseMultiSelectOptions<T>): UseMultiSelectResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const allIds = useMemo(() => items.map(getId), [items, getId]);
  const selectedOrderedIds = useMemo(
    () => allIds.filter((id) => selectedIds.has(id)),
    [allIds, selectedIds]
  );

  const toggle = useCallback(
    (id: string, options?: { range?: boolean }) => {
      if (options?.range && lastSelectedId && lastSelectedId !== id) {
        const fromIndex = allIds.indexOf(lastSelectedId);
        const toIndex = allIds.indexOf(id);
        if (fromIndex !== -1 && toIndex !== -1) {
          const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
          setSelectedIds(new Set(allIds.slice(start, end + 1)));
          return;
        }
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastSelectedId(id);
    },
    [allIds, lastSelectedId]
  );

  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(allIds));
    setLastSelectedId(null);
  }, [allIds]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    selectedCount: selectedOrderedIds.length,
    selectedOrderedIds,
    toggle,
    selectAll,
    clear,
    isSelected,
  };
}
