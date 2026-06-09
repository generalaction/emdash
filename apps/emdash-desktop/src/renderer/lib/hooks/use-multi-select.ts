import { useCallback, useMemo, useState } from 'react';

interface SelectionAnchor {
  id: string;
  orderedIds: string[];
}

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
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const allIds = useMemo(() => items.map(getId), [items, getId]);
  const selectedOrderedIds = useMemo(
    () => allIds.filter((id) => selectedIds.has(id)),
    [allIds, selectedIds]
  );

  const toggle = useCallback(
    (id: string, options?: { range?: boolean }) => {
      if (options?.range && selectionAnchor && selectionAnchor.id !== id) {
        const fromIndex = selectionAnchor.orderedIds.indexOf(selectionAnchor.id);
        const toIndex = selectionAnchor.orderedIds.indexOf(id);
        if (fromIndex !== -1 && toIndex !== -1) {
          const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
          const rangeIds = selectionAnchor.orderedIds.slice(start, end + 1);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            rangeIds.forEach((rangeId) => next.add(rangeId));
            return next;
          });
          setSelectionAnchor({ id, orderedIds: allIds });
          return;
        }
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setSelectionAnchor({ id, orderedIds: allIds });
    },
    [allIds, selectionAnchor]
  );

  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setSelectionAnchor(null);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(allIds));
    setSelectionAnchor(null);
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
