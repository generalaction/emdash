import { useCallback, useMemo, useState } from 'react';

interface UseMultiSelectOptions<T> {
  items: ReadonlyArray<T>;
  getId: (item: T) => string;
}

export interface UseMultiSelectResult {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export function useMultiSelect<T>({
  items,
  getId,
}: UseMultiSelectOptions<T>): UseMultiSelectResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const allIds = useMemo(() => items.map(getId), [items, getId]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(allIds));
  }, [allIds]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return { selectedIds, toggle, selectAll, clear, isSelected };
}
