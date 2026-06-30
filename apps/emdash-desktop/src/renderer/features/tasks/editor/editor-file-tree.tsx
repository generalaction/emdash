import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  Link,
  Trash2,
} from 'lucide-react';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useRef, useState } from 'react';
import { CompactedPathLabel } from '@renderer/features/tasks/editor/compacted-path-label';
import type { FilesStore } from '@renderer/features/tasks/editor/stores/files-store';
import {
  buildVisibleRows,
  isExpandableFileTreeNode,
  isChainExpanded,
  isOpenableFileTreeNode,
  type TreeRow,
} from '@renderer/features/tasks/file-tree/tree-utils';
import { relativeToWorkspace } from '@renderer/features/tasks/stores/workspace-path';
import { useTabSelection } from '@renderer/features/tasks/task-tab-registry';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import {
  clearDraggedWorkspaceFile,
  getDraggedFilePaths,
  hasDraggedFiles,
  setDraggedWorkspaceFile,
} from '@renderer/lib/drag-files';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import { basenameFromAnyPath } from '@shared/path-name';
import type { FileTabResource } from './stores/file-tab-resource';

const MAX_COPY_FILE_BYTES = 10 * 1024 * 1024;

type ResultLikeError = { message?: string; type?: string; paths?: readonly string[] };

function resultErrorMessage(error: ResultLikeError): string {
  return error.message ?? error.type ?? 'Unknown error';
}

function conflictPaths(error: ResultLikeError): string[] {
  if (error.type !== 'conflict' || !Array.isArray(error.paths)) return [];
  return [...error.paths];
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function isPathWithinDeletedItem(path: string, deletedPath: string, closesDescendants: boolean) {
  return closesDescendants
    ? path === deletedPath || path.startsWith(`${deletedPath}/`)
    : path === deletedPath;
}

async function importLocalFiles(args: {
  files: FilesStore;
  projectId: string;
  workspaceId: string;
  srcPaths: string[];
  destDirPath: string;
  overwrite?: boolean;
}): Promise<void> {
  const { files, projectId, workspaceId, srcPaths, destDirPath, overwrite = false } = args;

  // Optimistic insert — tree updates the moment the drop lands. The watcher
  // event arriving after the copy finishes is a no-op for already-present nodes.
  const inserted = files.addOptimisticNodes(
    srcPaths.map((srcPath) => ({
      path: joinPath(destDirPath, basenameFromAnyPath(srcPath)),
      type: 'file',
    }))
  );

  const handleFailure = async (error: ResultLikeError) => {
    for (const p of inserted) files.removeNode(p);
    await files.registerDir(destDirPath, true);
    const message = resultErrorMessage(error);
    const existingPaths = conflictPaths(error);
    if (existingPaths.length > 0 && !overwrite) {
      const description =
        existingPaths.length === 1
          ? `${existingPaths[0]} already exists. Replace it with the dropped file?`
          : `${existingPaths.length} files already exist: ${existingPaths.join(', ')}. Replace them with the dropped files?`;
      showModal('confirmActionModal', {
        title: existingPaths.length === 1 ? 'Replace existing file?' : 'Replace existing files?',
        description,
        confirmLabel: 'Replace',
        variant: 'destructive',
        onSuccess: () => {
          void importLocalFiles({
            files,
            projectId,
            workspaceId,
            srcPaths,
            destDirPath,
            overwrite: true,
          });
        },
      });
      return;
    }

    toast({
      title: 'Import failed',
      description: message,
      variant: 'destructive',
    });
  };

  try {
    const result = await rpc.workspace.files.copyLocalFiles(
      projectId,
      workspaceId,
      srcPaths,
      destDirPath,
      {
        overwrite,
      }
    );
    if (!result.success) {
      await handleFailure(result.error);
      return;
    }
    files.confirmOptimisticNodes(inserted);
  } catch (error) {
    await handleFailure({
      type: 'fs_error',
      message: error instanceof Error ? error.message : 'The file could not be imported.',
    });
  }
}

const FileTreeRow = observer(function FileTreeRow({
  row,
  style,
}: {
  row: TreeRow;
  style: React.CSSProperties;
}) {
  const taskView = useWorkspaceViewModel();
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const editorView = taskView.editorView;
  const files = editorView.files;
  const { isActive, open: openFile } = useTabSelection('file', row.node.path);

  const node = row.node;
  const isExpanded = isChainExpanded(row.chain, editorView.expandedPaths);
  const isSelected = isActive;
  const relNodePath = relativeToWorkspace(workspace.path, node.path);
  const fileStatus = workspace.gitWorktree.fileChanges?.find((c) => c.path === node.path)?.status;
  const paddingLeft = row.renderDepth * 12 + 4;
  const isExpandable = isExpandableFileTreeNode(node);
  const isOpenable = isOpenableFileTreeNode(node);
  const deleteClosesDescendants = node.type === 'directory' || isExpandable;
  const isSymlink = node.type === 'symlink';
  const targetDirPath = isExpandable ? node.path : (node.parentPath ?? '');
  const chainPath = row.chain.length > 1 ? row.chain.map((n) => n.name).join('/') : null;
  const isHidden = row.chain.some((n) => n.isHidden);

  const toggleExpand = () => {
    // Expansion drives registration: the view model reaction registers newly expanded scopes and
    // unregisters collapsed ones with the projector, so we only toggle expandedPaths here.
    runInAction(() => {
      if (isChainExpanded(row.chain, editorView.expandedPaths)) {
        for (const segment of row.chain) {
          editorView.expandedPaths.delete(segment.path);
        }
      } else {
        for (const segment of row.chain) {
          editorView.expandedPaths.add(segment.path);
        }
      }
    });
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExpandable) {
      toggleExpand();
    } else if (isOpenable) {
      openFile({ path: node.path }, { preview: true });
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpenable) {
      openFile({ path: node.path }, { preview: false });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isExpandable) {
        toggleExpand();
      } else if (isOpenable) {
        openFile({ path: node.path }, { preview: true });
      }
    }
  };

  const copyFile = async () => {
    if (!isOpenable) return;

    try {
      const result = await rpc.workspace.files.readFile(
        projectId,
        workspaceId,
        node.path,
        MAX_COPY_FILE_BYTES
      );
      if (!result.success) {
        toast({
          title: 'Copy failed',
          description: resultErrorMessage(result.error),
          variant: 'destructive',
        });
        return;
      }
      if (result.data.truncated) {
        toast({
          title: 'Copy failed',
          description: 'File is too large to copy.',
          variant: 'destructive',
        });
        return;
      }
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
      const result = await rpc.workspace.files.getAbsolutePath(projectId, workspaceId, node.path);
      if (!result.success) {
        toast({
          title: 'Copy failed',
          description: resultErrorMessage(result.error),
          variant: 'destructive',
        });
        return;
      }
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
      await rpc.app.clipboardWriteText(relNodePath);
      toast({ title: 'Relative path copied' });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: error instanceof Error ? error.message : 'The path could not be copied.',
        variant: 'destructive',
      });
    }
  };

  const closeDeletedFileTabs = () => {
    for (const { pane } of taskView.paneLayout.groups) {
      for (const tab of pane.resolvedTabs) {
        if (tab.kind !== 'file') continue;
        const resource = tab.resource as FileTabResource;
        if (isPathWithinDeletedItem(resource.path, node.path, deleteClosesDescendants)) {
          void pane.closeTab(tab.tabId);
        }
      }
    }
  };

  const deleteItem = async () => {
    try {
      const result = await rpc.workspace.files.removeFile(projectId, workspaceId, node.path, {
        recursive: node.type === 'directory',
      });
      if (!result.success) throw new Error(resultErrorMessage(result.error));
      if (!result.data.success) throw new Error(result.data.error ?? 'Delete failed.');

      closeDeletedFileTabs();
      files?.removeNode(node.path);
      await files?.registerDir(node.parentPath ?? workspace.path, true);
      toast({
        title:
          node.type === 'directory'
            ? 'Folder deleted'
            : isSymlink
              ? 'Link deleted'
              : 'File deleted',
      });
    } catch (error) {
      await files?.registerDir(node.parentPath ?? workspace.path, true);
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'The item could not be deleted.',
        variant: 'destructive',
      });
    }
  };

  const confirmDelete = () => {
    showModal('confirmActionModal', {
      title:
        node.type === 'directory' ? 'Delete folder?' : isSymlink ? 'Delete link?' : 'Delete file?',
      description:
        node.type === 'directory'
          ? `"${node.path}" and all of its contents will be deleted from the workspace.`
          : isSymlink
            ? `"${node.path}" will be removed from the workspace. Its target will not be deleted.`
            : `"${node.path}" will be deleted from the workspace.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        void deleteItem();
      },
    });
  };

  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleDragStart = (event: React.DragEvent) => {
    // Carry the path in the workspace environment so drop targets can inject it
    // without knowing which workspace rendered the file tree.
    setDraggedWorkspaceFile(event.dataTransfer, {
      workspaceId,
      targetPath: node.path,
      targetPlatform: workspace.sshConnectionId ? 'linux' : undefined,
    });
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
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
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(false);
    const srcPaths = getDraggedFilePaths(event.dataTransfer);
    if (srcPaths.length === 0) return;

    void (async () => {
      if (!files) return;
      // Expand and load the target directory so optimistic nodes can be inserted immediately.
      if (isExpandable) {
        runInAction(() => {
          for (const segment of row.chain) {
            editorView.expandedPaths.add(segment.path);
          }
        });
        if (!files.loadedPaths.has(node.path)) {
          await files.registerDir(node.path);
        }
      }

      await importLocalFiles({
        files,
        projectId,
        workspaceId,
        srcPaths,
        destDirPath: targetDirPath,
      });
    })();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={{ ...style, paddingLeft }}
        className={cn(
          'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md pr-2 hover:bg-background-1',
          isSelected && 'bg-background-2 hover:bg-background-2',
          isDropTarget && 'bg-blue-500/15 outline outline-1 outline-blue-500/60',
          isHidden && 'opacity-60'
        )}
        tabIndex={0}
        draggable
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onDragStart={handleDragStart}
        onDragEnd={clearDraggedWorkspaceFile}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={isExpandable ? isExpanded : undefined}
      >
        <span className="text-muted-foreground shrink-0">
          {isExpandable ? (
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
          {isSymlink ? (
            <Link className="text-muted-foreground h-3.5 w-3.5" />
          ) : node.type === 'directory' ? (
            isExpanded ? (
              <FolderOpen className="text-muted-foreground h-3.5 w-3.5" />
            ) : (
              <Folder className="text-muted-foreground h-3.5 w-3.5" />
            )
          ) : (
            <FileIcon filename={node.name} size={12} />
          )}
        </span>

        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            fileStatus === 'added' && 'text-foreground-success',
            fileStatus === 'modified' && 'text-foreground-warning',
            fileStatus === 'deleted' && 'text-foreground-error line-through',
            fileStatus === 'renamed' && 'text-blue-500'
          )}
        >
          {chainPath !== null ? <CompactedPathLabel path={chainPath} /> : node.name}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {isOpenable && (
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
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={confirmDelete}>
          <Trash2 className="size-4" />
          Delete
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
  const editorView = taskView.editorView;
  const files = editorView.files;
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);

  const visibleRows = files
    ? buildVisibleRows(
        files.rootNodes,
        editorView.expandedPaths,
        files.childrenById,
        files.loadedPaths
      )
    : [];

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  const handleRootDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOverRoot(false);
    const srcPaths = getDraggedFilePaths(event.dataTransfer);
    if (srcPaths.length === 0) return;
    if (!files) return;

    void importLocalFiles({
      files,
      projectId,
      workspaceId,
      srcPaths,
      destDirPath: workspace.path,
    });
  };

  const handleRootDragOver = (event: React.DragEvent) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
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
      <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
        Loading...
      </div>
    );
  }

  if (files?.error) {
    return (
      <div className="text-destructive flex h-full items-center justify-center text-xs">
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
            const row = visibleRows[vItem.index];
            return (
              <FileTreeRow
                key={row.node.path}
                row={row}
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
