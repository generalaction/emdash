import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { forwardRef, useCallback, useMemo, useRef, useState, type ButtonHTMLAttributes } from 'react';
import {
  buildVisibleRows,
  isChainExpanded,
  type TreeRow,
} from '@renderer/features/tasks/editor/stores/files-store-utils';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { cn } from '@renderer/utils/utils';
import { type GitChange } from '@shared/git';
import {
  ChangeContextMenu,
  ChangeStatusAffordance,
  type RenderChangeContextMenu,
} from './changes-list-item';
import { buildChangesTree } from './changes-tree-utils';

export interface VirtualizedChangesTreeProps {
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

export function VirtualizedChangesTree({
  changes,
  onSelectChange,
  onDoubleClickChange,
  isSelected,
  onToggleSelect,
  onPrefetch,
  renderContextMenu,
  activePath,
  className,
}: VirtualizedChangesTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildChangesTree(changes), [changes]);

  const expandedPaths = useMemo(() => {
    const expanded = new Set<string>();
    for (const path of tree.directoryPaths) {
      if (!collapsedPaths.has(path)) expanded.add(path);
    }
    return expanded;
  }, [tree.directoryPaths, collapsedPaths]);

  const visibleRows = useMemo(
    () => buildVisibleRows(tree.rootNodes, expandedPaths),
    [tree, expandedPaths]
  );

  const toggleChain = useCallback((chain: readonly { path: string }[], expanded: boolean) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      for (const segment of chain) {
        if (expanded) next.add(segment.path);
        else next.delete(segment.path);
      }
      return next;
    });
  }, []);

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
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
          const row = visibleRows[virtualItem.index]!;
          const node = row.node;
          const style: React.CSSProperties = {
            position: 'absolute',
            top: virtualItem.start,
            left: 0,
            width: '100%',
            height: ITEM_HEIGHT,
          };
          if (node.type === 'directory') {
            const expanded = isChainExpanded(row.chain, expandedPaths);
            return (
              <DirectoryRow
                key={`${node.type}:${node.path}`}
                row={row}
                isExpanded={expanded}
                onToggle={() => toggleChain(row.chain, expanded)}
                style={style}
              />
            );
          }
          const change = tree.changeByPath.get(node.path);
          if (!change) return null;
          return (
            <ChangeContextMenu
              key={`${node.type}:${node.path}`}
              change={change}
              renderContextMenu={renderContextMenu}
            >
              <FileRow
                row={row}
                change={change}
                isSelected={isSelected?.(change.path) ?? false}
                isActive={change.path === activePath}
                onToggleSelect={onToggleSelect}
                onClick={() => onSelectChange?.(change)}
                onDoubleClick={() => onDoubleClickChange?.(change)}
                onMouseEnter={() => onPrefetch?.(change)}
                style={style}
              />
            </ChangeContextMenu>
          );
        })}
      </div>
    </div>
  );
}

function DirectoryRow({
  row,
  isExpanded,
  onToggle,
  style,
}: {
  row: TreeRow;
  isExpanded: boolean;
  onToggle: () => void;
  style: React.CSSProperties;
}) {
  const paddingLeft = row.renderDepth * 12 + 4;
  const displayName =
    row.chain.length > 1 ? row.chain.map((segment) => segment.name).join('/') : row.node.name;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group/item flex h-7 w-full items-center gap-1.5 rounded-md pr-2 select-none hover:bg-background-1"
      style={{ ...style, paddingLeft }}
    >
      <span className="shrink-0 text-foreground-muted">
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="shrink-0 text-foreground-muted">
        {isExpanded ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-sm">{displayName}</span>
    </button>
  );
}

interface FileRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  row: TreeRow;
  change: GitChange;
  isSelected: boolean;
  isActive: boolean;
  onToggleSelect?: (path: string) => void;
}

const FileRow = forwardRef<HTMLButtonElement, FileRowProps>(function FileRow(
  { row, change, isSelected, isActive, onToggleSelect, className, style, ...props },
  ref
) {
  const paddingLeft = row.renderDepth * 12 + 4;
  const node = row.node;
  return (
    <button
      type="button"
      ref={ref}
      style={{ ...style, paddingLeft }}
      className={cn(
        'group/item flex h-7 w-full select-none items-center gap-2 rounded-md pr-2 hover:bg-background-1',
        isActive && 'bg-background-2 hover:bg-background-2',
        className
      )}
      {...props}
    >
      <span className="inline-block w-3.5 shrink-0" />
      <span className="shrink-0">
        <FileIcon filename={node.name} size={12} />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left text-sm',
          change.status === 'deleted' && 'line-through text-foreground-muted'
        )}
      >
        {node.name}
      </span>
      <ChangeStatusAffordance
        change={change}
        filename={node.name}
        isSelected={isSelected}
        onToggleSelect={onToggleSelect}
      />
    </button>
  );
});
