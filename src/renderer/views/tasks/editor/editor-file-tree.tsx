import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useRef } from 'react';
import type { FileNode } from '@shared/fs';
import { FileIcon } from '@renderer/core/editor/file-icon';
import { buildVisibleRows } from '@renderer/core/stores/files-store-utils';
import { getTaskView } from '@renderer/core/stores/task-selectors';
import { cn } from '@renderer/lib/utils';
import { useRequireProvisionedTask, useTaskViewContext } from '../task-view-context';

const FileTreeRow = observer(function FileTreeRow({
  node,
  style,
}: {
  node: FileNode;
  style: React.CSSProperties;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const taskState = useRequireProvisionedTask();
  const taskView = getTaskView(projectId, taskId);
  const editorView = taskState.editorView;

  const isExpanded = editorView.expandedPaths.has(node.path);
  const isSelected = taskView?.view === 'editor' && editorView.activeFilePath === node.path;
  const fileStatus = taskState.workspace.git.fileChanges?.find((c) => c.path === node.path)?.status;
  const paddingLeft = node.depth * 12 + 4;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (taskView?.view !== 'editor') {
      taskView?.setView('editor');
    }
    if (node.type === 'directory') {
      toggleExpand();
    } else {
      editorView.openFilePreview(node.path);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'file') {
      editorView.openFile(node.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (node.type === 'directory') {
        toggleExpand();
      } else {
        editorView.openFilePreview(node.path);
      }
    }
  };

  const toggleExpand = () => {
    if (editorView.expandedPaths.has(node.path)) {
      editorView.expandedPaths.delete(node.path);
    } else {
      editorView.expandedPaths.add(node.path);
      if (!taskState.workspace.files.loadedPaths.has(node.path)) {
        void taskState.workspace.files.loadDir(node.path);
      }
    }
  };

  return (
    <div
      style={{ ...style, paddingLeft }}
      className={cn(
        'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md pr-2 hover:bg-background-1',
        isSelected && 'bg-background-2 hover:bg-background-2',
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
  const taskState = useRequireProvisionedTask();
  const files = taskState.workspace.files;
  const editorView = taskState.editorView;

  const visibleRows = files
    ? buildVisibleRows(files.nodes, files.childIndex, editorView.expandedPaths)
    : [];

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  if (files?.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (files?.error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        {files.error}
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
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});
