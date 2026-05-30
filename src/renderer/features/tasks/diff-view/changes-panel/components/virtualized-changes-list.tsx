import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { cn } from '@renderer/utils/utils';
import { type GitChange } from '@shared/git';
import {
  ChangeContextMenu,
  ChangesListItem,
  type RenderChangeContextMenu,
} from './changes-list-item';

export interface VirtualizedChangesListProps {
  changes: GitChange[];
  onSelectChange?: (change: GitChange) => void;
  onDoubleClickChange?: (change: GitChange) => void;
  isSelected?: (path: string) => boolean;
  onToggleSelect?: (path: string) => void;
  onPrefetch?: (change: GitChange) => void;
  renderContextMenu?: RenderChangeContextMenu;
  activePath?: string;
  className?: string;
}

const ITEM_HEIGHT = 28;

export function VirtualizedChangesList({
  changes,
  onSelectChange,
  onDoubleClickChange,
  isSelected,
  onToggleSelect,
  onPrefetch,
  renderContextMenu,
  activePath,
  className,
}: VirtualizedChangesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: changes.length,
    gap: 2,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });
  return (
    <div
      ref={parentRef}
      className={cn('h-full overflow-y-auto overflow-x-hidden py-2 px-1', className)}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const change = changes[virtualItem.index]!;
          return (
            <ChangeContextMenu
              key={change.path}
              change={change}
              renderContextMenu={renderContextMenu}
            >
              <ChangesListItem
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
                onDoubleClick={() => onDoubleClickChange?.(change)}
                onMouseEnter={() => onPrefetch?.(change)}
              />
            </ChangeContextMenu>
          );
        })}
      </div>
    </div>
  );
}
