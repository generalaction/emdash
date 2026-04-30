import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { type GitChange } from '@shared/git';
import { cn } from '@renderer/utils/utils';
import { ChangesListItem } from './changes-list-item';

export interface VirtualizedChangesListProps {
  changes: GitChange[];
  onSelectChange?: (change: GitChange) => void;
  isSelected?: (path: string) => boolean;
  onToggleSelect?: (path: string) => void;
  onPrefetch?: (change: GitChange) => void;
  activePath?: string;
  className?: string;
}

const ITEM_HEIGHT = 28;

export function VirtualizedChangesList({
  changes,
  onSelectChange,
  isSelected,
  onToggleSelect,
  onPrefetch,
  activePath,
  className,
}: VirtualizedChangesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: changes.length,
    gap: 2,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });
  return (
    <div ref={parentRef} className={cn('h-full overflow-y-auto overflow-x-hidden py-2', className)}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const change = changes[virtualItem.index]!;
          return (
            <ChangesListItem
              key={change.path}
              change={change}
              isSelected={isSelected?.(change.path)}
              isActive={change.path === activePath}
              onToggleSelect={onToggleSelect}
              style={{
                position: 'absolute',
                top: virtualItem.start,
                left: 0,
                width: '100%',
                height: ITEM_HEIGHT,
              }}
              onClick={() => onSelectChange?.(change)}
              onMouseEnter={() => onPrefetch?.(change)}
            />
          );
        })}
      </div>
    </div>
  );
}
