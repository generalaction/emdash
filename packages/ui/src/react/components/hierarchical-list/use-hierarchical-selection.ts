import * as React from 'react';

export interface SelectionClickModifiers {
  shift?: boolean;
  alt?: boolean;
}

export interface SelectionClickResult {
  next: Set<string>;
  anchor: string | null;
}

export interface UseHierarchicalSelectionOptions {
  selectedIds?: ReadonlySet<string>;
  onSelectedIdsChange?: (ids: ReadonlySet<string>) => void;
}

export interface HierarchicalSelectionState {
  selectedIds: ReadonlySet<string>;
  count: number;
  isSelected: (id: string) => boolean;
  handleClick: (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void;
  clear: () => void;
}

export function applySelectionClick(
  prev: ReadonlySet<string>,
  id: string,
  orderedIds: readonly string[],
  anchor: string | null,
  modifiers: SelectionClickModifiers
): SelectionClickResult {
  if (modifiers.shift && anchor) {
    const anchorIndex = orderedIds.indexOf(anchor);
    const targetIndex = orderedIds.indexOf(id);

    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [lo, hi] =
        anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      const next = new Set(prev);
      for (const rangeId of orderedIds.slice(lo, hi + 1)) next.add(rangeId);
      return { next, anchor };
    }
  }

  if (modifiers.alt) {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return { next, anchor: id };
  }

  return { next: new Set([id]), anchor: id };
}

export function useHierarchicalSelection(
  orderedIds: readonly string[],
  { selectedIds: controlledSelectedIds, onSelectedIdsChange }: UseHierarchicalSelectionOptions = {}
): HierarchicalSelectionState {
  const [uncontrolledSelectedIds, setUncontrolledSelectedIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const anchorRef = React.useRef<string | null>(null);
  const isControlled = controlledSelectedIds !== undefined;
  const selectedIds = controlledSelectedIds ?? uncontrolledSelectedIds;

  const commitSelection = React.useCallback(
    (next: Set<string>) => {
      onSelectedIdsChange?.(next);
      if (!isControlled) {
        setUncontrolledSelectedIds(next);
      }
    },
    [isControlled, onSelectedIdsChange]
  );

  const isSelected = React.useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const handleClick = React.useCallback(
    (id: string, event?: React.MouseEvent | React.KeyboardEvent) => {
      const result = applySelectionClick(selectedIds, id, orderedIds, anchorRef.current, {
        shift: event?.shiftKey,
        alt: event?.altKey,
      });

      anchorRef.current = result.anchor;
      commitSelection(result.next);
    },
    [commitSelection, orderedIds, selectedIds]
  );

  const clear = React.useCallback(() => {
    anchorRef.current = null;
    commitSelection(new Set());
  }, [commitSelection]);

  return {
    selectedIds,
    count: selectedIds.size,
    isSelected,
    handleClick,
    clear,
  };
}
