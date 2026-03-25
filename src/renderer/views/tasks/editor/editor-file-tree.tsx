import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useRef } from 'react';
import type { FileNode } from '@shared/fs';
import { taskViewStateStore } from '@renderer/core/tasks/view/task-view-store';
import { cn } from '@renderer/lib/utils';
import { FileIcon } from '../../../core/editor/file-icon';
import { useTaskViewContext } from '../task-view-context';
import { useEditorContext } from './editor-provider';
import { useFileTreeContext } from './file-tree/filetree-provider';

interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

const FileTreeRow = React.memo(function FileTreeRow({
  node,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onOpen,
  fileChanges,
  style,
  view,
  onSetEditorView,
}: {
  node: FileNode;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onOpen?: () => void;
  fileChanges: FileChange[];
  style: React.CSSProperties;
  view: string;
  onSetEditorView: () => void;
}) {
  const fileStatus = fileChanges.find((c) => c.path === node.path)?.status;
  const paddingLeft = node.depth * 12 + 4;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (view !== 'editor') {
      onSetEditorView();
    }
    if (node.type === 'directory') {
      onToggle();
    } else {
      onSelect();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'file' && onOpen) {
      onOpen();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (node.type === 'directory') {
        onToggle();
      } else {
        onSelect();
      }
    }
  };

  return (
    <div
      style={{ ...style, paddingLeft }}
      className={cn(
        'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md pr-2 hover:bg-muted/50',
        isSelected && 'bg-muted',
        node.isHidden && 'opacity-60'
      )}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={node.type === 'directory' ? isExpanded : undefined}
    >
      <span className="shrink-0 text-muted-foreground">
        {node.type === 'directory' ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )
        ) : (
          <span className="inline-block w-3.5" />
        )}
      </span>

      <span className="shrink-0">
        {node.type === 'directory' ? (
          isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Folder className="h-3.5 w-3.5 text-muted-foreground" />
          )
        ) : (
          <FileIcon filename={node.name} size={12} />
        )}
      </span>

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          fileStatus === 'added' && 'text-green-500',
          fileStatus === 'modified' && 'text-amber-500',
          fileStatus === 'deleted' && 'text-red-500 line-through',
          fileStatus === 'renamed' && 'text-blue-500'
        )}
      >
        {node.name}
      </span>
    </div>
  );
});

export const EditorFileTree = observer(function EditorFileTree() {
  const { taskId } = useTaskViewContext();
  const taskState = taskViewStateStore.getOrCreate(taskId);
  const { activeFilePath, loadFile, openFilePreview, fileChanges } = useEditorContext();
  const { visibleRows, expandedPaths, toggleExpand, isLoading, error } = useFileTreeContext();

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (visibleRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No files
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div ref={parentRef} className="flex-1 overflow-y-auto px-1 py-1" role="tree">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const node = visibleRows[vItem.index] as FileNode;
            return (
              <FileTreeRow
                key={node.path}
                node={node}
                style={{
                  position: 'absolute',
                  top: vItem.start,
                  left: 0,
                  width: '100%',
                  height: `${vItem.size}px`,
                }}
                view={taskState.view}
                onSetEditorView={() => taskState.setView('editor')}
                isExpanded={expandedPaths.has(node.path)}
                isSelected={taskState.view === 'editor' && activeFilePath === node.path}
                onToggle={() => toggleExpand(node.path)}
                onSelect={() => void openFilePreview(node.path)}
                onOpen={() => void loadFile(node.path)}
                fileChanges={fileChanges}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});
