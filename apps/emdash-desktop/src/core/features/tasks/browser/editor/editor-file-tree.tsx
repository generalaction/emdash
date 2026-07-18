import { MAX_FILE_UPLOAD_BYTES } from '@emdash/core/runtimes/files/api';
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
import { observer } from 'mobx-react-lite';
import React, { useRef, useState } from 'react';
import { CompactedPathLabel } from '@core/features/tasks/browser/editor/compacted-path-label';
import type { FilesStore } from '@core/features/tasks/browser/editor/stores/files-store';
import {
  buildFileTreeVisibleRows,
  isExpandableFileTreeNode,
  isChainExpanded,
  isOpenableFileTreeNode,
  type TreeRow,
} from '@core/features/tasks/browser/file-tree/tree-utils';
import { relativeToWorkspace } from '@core/features/tasks/browser/stores/workspace-path';
import {
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@core/features/tasks/browser/task-view-context';
import { useTabSelection } from '@core/features/workbench/browser/task-tab-registry';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import {
  clearDraggedWorkspaceFile,
  hasDraggedFiles,
  setDraggedWorkspaceFile,
} from '@renderer/lib/drag-files';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import { openModal, useOpenModal } from '@renderer/lib/modal/api';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { filesPath } from '@renderer/lib/runtime/files';
import { getFilesRuntimeClient } from '@renderer/lib/runtime/files-client';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import type { FileTabResource } from './stores/file-tab-resource';

const MAX_COPY_FILE_BYTES = 10 * 1024 * 1024;
const PLATFORM = detectPlatformContext().os;
const REVEAL_LABEL =
  PLATFORM === 'mac'
    ? 'Show in Finder'
    : PLATFORM === 'windows'
      ? 'Show in File Explorer'
      : 'Show in File Manager';

type ResultLikeError = { message?: string; type?: string; paths?: readonly string[] };

function resultErrorMessage(error: ResultLikeError | string | undefined): string {
  if (typeof error === 'string') return error;
  if (!error) return 'Unknown error';
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
  workspacePath: string;
  sourceFiles: File[];
  destDirPath: string;
  overwrite?: boolean;
}): Promise<void> {
  const { files, workspacePath, sourceFiles, destDirPath, overwrite = false } = args;
  const oversizedFile = sourceFiles.find((file) => file.size > MAX_FILE_UPLOAD_BYTES);
  if (oversizedFile) {
    toast({
      title: 'Import failed',
      description: `${oversizedFile.name} exceeds the 10 MB upload limit.`,
      variant: 'destructive',
    });
    return;
  }
  const destinations = sourceFiles.map((file) => joinPath(destDirPath, file.name));
  if (new Set(destinations).size !== destinations.length) {
    toast({
      title: 'Import failed',
      description: 'Multiple dropped files have the same destination name.',
      variant: 'destructive',
    });
    return;
  }

  // Optimistic insert — tree updates the moment the drop lands. The watcher
  // event arriving after the copy finishes is a no-op for already-present nodes.
  const inserted = files.addOptimisticNodes(
    destinations.map((path) => ({
      path,
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
      const outcome = await openModal('confirmActionModal', {
        title: existingPaths.length === 1 ? 'Replace existing file?' : 'Replace existing files?',
        description,
        confirmLabel: 'Replace',
        variant: 'destructive',
      });
      if (outcome.success) {
        void importLocalFiles({
          files,
          workspacePath,
          sourceFiles,
          destDirPath,
          overwrite: true,
        });
      }
      return;
    }

    toast({
      title: 'Import failed',
      description: message,
      variant: 'destructive',
    });
  };

  try {
    const client = await getFilesRuntimeClient();
    if (!overwrite) {
      const conflicts: string[] = [];
      for (const destination of destinations) {
        const target = filesPath(workspacePath, destination);
        const result = await client.fs.exists(target);
        if (!result.success) {
          await handleFailure(result.error);
          return;
        }
        if (result.data) conflicts.push(target.relative);
      }
      if (conflicts.length > 0) {
        await handleFailure({
          type: 'conflict',
          message: 'Files already exist',
          paths: conflicts,
        });
        return;
      }
    }

    for (const [index, sourceFile] of sourceFiles.entries()) {
      const destination = filesPath(workspacePath, destinations[index]);
      const result = await client.fs.upload(
        { root: destination.root, path: destination.relative, overwrite },
        {
          name: sourceFile.name,
          mimeType: sourceFile.type || 'application/octet-stream',
          size: sourceFile.size,
          lastModified: sourceFile.lastModified,
          source: sourceFile.stream(),
        }
      );
      if (!result.success) {
        await handleFailure(result.error);
        return;
      }
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
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const editorView = taskView.editorView;
  const files = editorView.files;
  const openConfirmActionModal = useOpenModal('confirmActionModal');
  const { isActive, open: openFile } = useTabSelection('file', row.node.path);

  const node = row.node;
  const isExpanded = isChainExpanded(row.chain, editorView.expandedPaths);
  const isSelected = isActive;
  const relNodePath = relativeToWorkspace(workspace.path, node.path);
  const fileStatus = workspace.gitCheckout.fileChanges?.find((c) => c.path === relNodePath)?.status;
  const paddingLeft = row.renderDepth * 12 + 4;
  const isExpandable = isExpandableFileTreeNode(node);
  const isOpenable = isOpenableFileTreeNode(node);
  const deleteClosesDescendants = node.type === 'directory' || isExpandable;
  const isSymlink = node.type === 'symlink';
  const targetDirPath = isExpandable ? node.path : (node.parentPath ?? '');
  const chainPath = row.chain.length > 1 ? row.chain.map((n) => n.name).join('/') : null;
  const isHidden = row.chain.some((n) => n.isHidden);

  const toggleExpand = () => {
    // Expansion drives registration; collapse only changes visibility and keeps loaded scopes warm.
    const paths = row.chain.map((segment) => segment.path);
    if (isChainExpanded(row.chain, editorView.expandedPaths)) {
      editorView.collapsePaths(paths);
    } else {
      editorView.expandPaths(paths);
    }
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
      const client = await getFilesRuntimeClient();
      const result = await client.fs.readText({
        ...filesPath(workspace.path, node.path),
        options: { maxBytes: MAX_COPY_FILE_BYTES },
      });
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
      const client = await getFilesRuntimeClient();
      const result = await client.fs.realPath(filesPath(workspace.path, node.path));
      if (!result.success) {
        toast({
          title: 'Copy failed',
          description: resultErrorMessage(result.error),
          variant: 'destructive',
        });
        return;
      }
      await rpc.app.clipboardWriteText(nativePathFromHost(result.data));
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

  const revealInFileManager = async () => {
    try {
      const result = await rpc.app.showWorkspaceItemInFolder({
        workspaceId,
        relativePath: relNodePath,
      });
      if (!result.success) {
        toast({
          title: 'Show failed',
          description: resultErrorMessage(result.error),
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Show failed',
        description: error instanceof Error ? error.message : 'The item could not be shown.',
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
      const client = await getFilesRuntimeClient();
      const path = filesPath(workspace.path, node.path);
      const result = await client.mutations.delete({
        root: path.root,
        path: path.relative,
        recursive: node.type === 'directory',
      });
      if (!result.success) throw new Error(resultErrorMessage(result.error));

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
    void (async () => {
      const outcome = await openConfirmActionModal({
        title:
          node.type === 'directory'
            ? 'Delete folder?'
            : isSymlink
              ? 'Delete link?'
              : 'Delete file?',
        description:
          node.type === 'directory'
            ? `"${node.path}" and all of its contents will be deleted from the workspace.`
            : isSymlink
              ? `"${node.path}" will be removed from the workspace. Its target will not be deleted.`
              : `"${node.path}" will be deleted from the workspace.`,
        confirmLabel: 'Delete',
        variant: 'destructive',
      });
      if (outcome.success) {
        void deleteItem();
      }
    })();
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
    const sourceFiles = Array.from(event.dataTransfer.files);
    if (sourceFiles.length === 0) return;

    void (async () => {
      if (!files) return;
      // Expand and load the target directory so optimistic nodes can be inserted immediately.
      if (isExpandable) {
        editorView.expandPaths(row.chain.map((segment) => segment.path));
        if (!files.loadedPaths.has(node.path)) {
          await files.registerDir(node.path);
        }
      }

      await importLocalFiles({
        files,
        workspacePath: workspace.path,
        sourceFiles,
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
        {!workspace.sshConnectionId && (
          <ContextMenuItem onClick={() => void revealInFileManager()}>
            <FolderOpen className="size-4" />
            {REVEAL_LABEL}
          </ContextMenuItem>
        )}
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
  const taskView = useWorkspaceViewModel();
  const editorView = taskView.editorView;
  const files = editorView.files;
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);

  const visibleRows = files
    ? buildFileTreeVisibleRows(
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
    const sourceFiles = Array.from(event.dataTransfer.files);
    if (sourceFiles.length === 0) return;
    if (!files) return;

    void importLocalFiles({
      files,
      workspacePath: workspace.path,
      sourceFiles,
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
