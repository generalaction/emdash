import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Copy, FileText, Folder, FolderOpen } from 'lucide-react';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useRef, useState } from 'react';
import type { FileNode } from '@shared/fs';
import { basenameFromAnyPath } from '@shared/path-name';
import type { FilesStore } from '@renderer/features/tasks/editor/stores/files-store';
import { buildVisibleRows } from '@renderer/features/tasks/editor/stores/files-store-utils';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';

const MAX_COPY_FILE_BYTES = 10 * 1024 * 1024;

function resultErrorMessage(error: { message?: string; type?: string }): string {
  return error.message ?? error.type ?? 'Unknown error';
}

function getLocalFilePaths(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.files)
    .map((file) => window.electronAPI.getPathForFile(file).trim())
    .filter(Boolean);
}

// `dataTransfer.files` is empty during `dragover`/`dragenter` — only `types`
// is populated until the drop fires. Use this for dragover detection.
function hasFileDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes('Files');
}

function joinRelPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

async function importLocalFiles(args: {
  files: FilesStore;
  projectId: string;
  workspaceId: string;
  srcPaths: string[];
  destDirPath: string;
}): Promise<void> {
  const { files, projectId, workspaceId, srcPaths, destDirPath } = args;

  // Optimistic insert — tree updates the moment the drop lands. The watcher
  // event arriving after the copy finishes is a no-op for already-present nodes.
  const inserted: string[] = [];
  for (const srcPath of srcPaths) {
    const destRel = joinRelPath(destDirPath, basenameFromAnyPath(srcPath));
    if (files.addOptimisticNode(destRel, 'file')) inserted.push(destRel);
  }

  try {
    const result = await rpc.fs.copyLocalFiles(projectId, workspaceId, srcPaths, destDirPath);
    if (!result.success) throw new Error(resultErrorMessage(result.error));
  } catch (error) {
    for (const p of inserted) files.removeNode(p);
    await files.loadDir(destDirPath, true);
    toast({
      title: 'Import failed',
      description: error instanceof Error ? error.message : 'The file could not be imported.',
      variant: 'destructive',
    });
  }
}

const FileTreeRow = observer(function FileTreeRow({
  node,
  style,
}: {
  node: FileNode;
  style: React.CSSProperties;
}) {
  const taskView = useWorkspaceViewModel();
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const editorView = taskView.editorView;

  const isExpanded = editorView.expandedPaths.has(node.path);
  const isSelected = taskView.tabManager.activeFilePath === node.path;
  const fileStatus = workspace.git.fileChanges?.find((c) => c.path === node.path)?.status;
  const paddingLeft = node.depth * 12 + 4;
  const targetDirPath = node.type === 'directory' ? node.path : (node.parentPath ?? '');

  const toggleExpand = () => {
    runInAction(() => {
      if (editorView.expandedPaths.has(node.path)) {
        editorView.expandedPaths.delete(node.path);
      } else {
        editorView.expandedPaths.add(node.path);
        if (!workspace.files.loadedPaths.has(node.path)) {
          void workspace.files.loadDir(node.path);
        }
      }
    });
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'directory') {
      toggleExpand();
    } else {
      taskView.tabManager.openFilePreview(node.path);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'file') {
      taskView.tabManager.openFile(node.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (node.type === 'directory') {
        toggleExpand();
      } else {
        taskView.tabManager.openFilePreview(node.path);
      }
    }
  };

  const copyFile = async () => {
    if (node.type !== 'file') return;

    try {
      const result = await rpc.fs.readFile(projectId, workspaceId, node.path, MAX_COPY_FILE_BYTES);
      if (!result.success) throw new Error(resultErrorMessage(result.error));
      if (result.data.truncated) throw new Error('File is too large to copy.');
      await rpc.app.clipboardWriteText(result.data.content);
      toast({ title: 'File copied' });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: error instanceof Error ? error.message : 'The file could not be copied.',
        variant: 'destructive',
      });
    }
  };

  const copyPath = async () => {
    try {
      const result = await rpc.fs.getAbsolutePath(projectId, workspaceId, node.path);
      if (!result.success) throw new Error(resultErrorMessage(result.error));
      await rpc.app.clipboardWriteText(result.data.path);
      toast({ title: 'Path copied' });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: error instanceof Error ? error.message : 'The path could not be copied.',
        variant: 'destructive',
      });
    }
  };

  const copyRelativePath = async () => {
    try {
      await rpc.app.clipboardWriteText(node.path);
      toast({ title: 'Relative path copied' });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: error instanceof Error ? error.message : 'The path could not be copied.',
        variant: 'destructive',
      });
    }
  };

  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleDragOver = (event: React.DragEvent) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDropTarget) setIsDropTarget(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDropTarget(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    setIsDropTarget(false);
    const srcPaths = getLocalFilePaths(event.dataTransfer);
    if (srcPaths.length === 0) return;
    event.preventDefault();
    event.stopPropagation();

    // Expand the target directory so the new node is visible immediately.
    if (node.type === 'directory' && !editorView.expandedPaths.has(node.path)) {
      runInAction(() => editorView.expandedPaths.add(node.path));
    }

    void importLocalFiles({
      files: workspace.files,
      projectId,
      workspaceId,
      srcPaths,
      destDirPath: targetDirPath,
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={{ ...style, paddingLeft }}
        className={cn(
          'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md pr-2 hover:bg-background-1',
          isSelected && 'bg-background-2 hover:bg-background-2',
          isDropTarget && 'bg-blue-500/15 outline outline-1 outline-blue-500/60',
          node.isHidden && 'opacity-60'
        )}
        tabIndex={0}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        {node.type === 'file' && (
          <ContextMenuItem onClick={() => void copyFile()}>
            <FileText className="size-4" />
            Copy
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => void copyPath()}>
          <Copy className="size-4" />
          Copy path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void copyRelativePath()}>
          <Copy className="size-4" />
          Copy relative path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export const EditorFileTree = observer(function EditorFileTree() {
  const workspace = useWorkspace();
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const files = workspace.files;
  const editorView = taskView.editorView;
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);

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

  const handleRootDrop = (event: React.DragEvent) => {
    setIsDragOverRoot(false);
    const srcPaths = getLocalFilePaths(event.dataTransfer);
    if (srcPaths.length === 0) return;
    event.preventDefault();
    event.stopPropagation();

    void importLocalFiles({
      files: workspace.files,
      projectId,
      workspaceId,
      srcPaths,
      destDirPath: '',
    });
  };

  const handleRootDragOver = (event: React.DragEvent) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragOverRoot(true);
  };

  const handleRootDragLeave = (event: React.DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragOverRoot(false);
  };

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
      <div
        className={cn(
          'flex h-full items-center justify-center text-xs text-muted-foreground',
          isDragOverRoot && 'bg-background-1'
        )}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        No files
      </div>
    );
  }

  return (
    <div
      className={cn('flex h-full flex-col overflow-hidden', isDragOverRoot && 'bg-background-1')}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      <div ref={parentRef} className="flex-1 overflow-y-auto px-2 py-2" role="tree">
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
