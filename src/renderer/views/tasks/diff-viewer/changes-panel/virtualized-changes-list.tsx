import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { GitChange } from '@shared/git';
import { ChangesListItem } from './changes-list-item';

export interface VirtualizedChangesListProps {
  changes: GitChange[];
  onSelectChange?: (change: GitChange) => void;
  isSelected?: (path: string) => boolean;
  onToggleSelect?: (path: string) => void;
}

const ITEM_HEIGHT = 28;

export function VirtualizedChangesList({
  changes,
  onSelectChange,
  isSelected,
  onToggleSelect,
}: VirtualizedChangesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: changes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });
  return (
    <div ref={parentRef} className="overflow-y-auto h-full">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const change = changes[virtualItem.index]!;
          return (
            <ChangesListItem
              key={change.path}
              change={change}
              isSelected={isSelected?.(change.path)}
              onToggleSelect={onToggleSelect}
              style={{
                position: 'absolute',
                top: virtualItem.start,
                left: 0,
                width: '100%',
                height: ITEM_HEIGHT,
              }}
              onClick={() => onSelectChange?.(change)}
            />
          );
        })}
      </div>
    </div>
  );
}
