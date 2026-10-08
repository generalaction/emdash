import type { GitChange, GitFilePath } from '@emdash/core/runtimes/git/api';
import { isChainExpanded } from '@core/features/editor/api/browser/file-tree/tree-utils';
import { cn } from '@core/primitives/styling/browser/cn';
import { DirectoryRow, FileRow, useChangesTreeRows } from './virtualized-changes-tree';

interface NestedChangesTreeProps {
  changes: GitChange[];
  rootPath?: string;
  onSelectChange?: (change: GitChange) => void;
  onDoubleClickChange?: (change: GitChange) => void;
  onPrefetch?: (change: GitChange) => void;
  activePath?: GitFilePath;
  className?: string;
}

/** Non-virtualized tree for short change lists rendered inside another scroll container. */
export function NestedChangesTree({
  changes,
  rootPath,
  onSelectChange,
  onDoubleClickChange,
  onPrefetch,
  activePath,
  className,
}: NestedChangesTreeProps) {
  const { tree, expandedPaths, visibleRows, toggleChain } = useChangesTreeRows(changes, rootPath);

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {visibleRows.map((row) => {
        const node = row.node;
        if (node.type === 'directory') {
          const expanded = isChainExpanded(row.chain, expandedPaths);
          return (
            <DirectoryRow
              key={`${node.type}:${node.path}`}
              row={row}
              isExpanded={expanded}
              onToggle={() => toggleChain(row.chain, expanded)}
            />
          );
        }
        const change = tree.changeByPath.get(node.path);
        if (!change) return null;
        return (
          <FileRow
            key={`${node.type}:${node.path}`}
            row={row}
            change={change}
            isSelected={false}
            isActive={change.path === activePath}
            onClick={() => onSelectChange?.(change)}
            onDoubleClick={() => onDoubleClickChange?.(change)}
            onMouseEnter={() => onPrefetch?.(change)}
          />
        );
      })}
    </div>
  );
}
