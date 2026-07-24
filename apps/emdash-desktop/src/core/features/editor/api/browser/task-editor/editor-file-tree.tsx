import { FILE_SEARCH_MAX_QUERY_LENGTH } from '@emdash/core/runtimes/file-search/api';
import {
  FileTree,
  canMoveNode,
  isExpandableFileTreeNode,
  isOpenableFileTreeNode,
  joinFileTreePath,
  normalizeFileTreePath,
  type ChildrenById,
  type FileTreeContextMenuItem,
  type FileTreeHeaderContext,
  type FileTreeNode,
  type FileTreeRowState,
} from '@emdash/ui/react/components';
import {
  Copy,
  CopyMinus,
  FilePen,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  Link2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { getEditorClient } from '@core/features/editor/api/browser/client';
import type { RenderableFileNode } from '@core/features/editor/api/browser/file-tree/tree-utils';
import { editorFilePath } from '@core/features/editor/api/browser/files';
import { FileIcon } from '@core/features/editor/api/browser/renderers/file-icon';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import {
  useTaskComposition,
  useWorkspace,
  useWorkspaceId,
} from '@core/features/workbench/api/browser/task-composition-context';
import { useTabLayout } from '@core/features/workbench/api/browser/task-tab-registry';
import { relativeToWorkspace } from '@core/features/workspaces/api/browser/workspace-path';
import { openModal, useOpenModal } from '@core/manifests/browser/modal-api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import { Input } from '@core/primitives/ui/browser/input';
import { toast } from '@core/primitives/ui/browser/use-toast';
import { clearDraggedWorkspaceFile, setDraggedWorkspaceFile } from '@renderer/lib/drag-files';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { MAX_EDITOR_FILE_UPLOAD_BYTES } from '../..';
import { FileContentSearchResults } from '../../../browser/task-editor/file-content-search';
import type { FilesStore } from '../../../browser/task-editor/stores/files-store';

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

async function importLocalFiles(args: {
  files: FilesStore;
  workspaceId: string;
  workspacePath: string;
  sourceFiles: File[];
  destDirPath: string;
  overwrite?: boolean;
}): Promise<void> {
  const { files, workspaceId, workspacePath, sourceFiles, destDirPath, overwrite = false } = args;
  const oversizedFile = sourceFiles.find((file) => file.size > MAX_EDITOR_FILE_UPLOAD_BYTES);
  if (oversizedFile) {
    toast({
      title: 'Import failed',
      description: `${oversizedFile.name} exceeds the 10 MB upload limit.`,
      variant: 'destructive',
    });
    return;
  }
  const destinations = sourceFiles.map((file) => joinFileTreePath(destDirPath, file.name));
  if (new Set(destinations).size !== destinations.length) {
    toast({
      title: 'Import failed',
      description: 'Multiple dropped files have the same destination name.',
      variant: 'destructive',
    });
    return;
  }

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
          workspaceId,
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
    const client = await getEditorClient();
    if (!overwrite) {
      const conflicts: string[] = [];
      for (const destination of destinations) {
        const target = editorFilePath(workspaceId, workspacePath, destination);
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
      const destination = editorFilePath(workspaceId, workspacePath, destinations[index]);
      const result = await client.fs.upload(
        { workspaceId, path: destination.relative, overwrite },
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

export const EditorFileTree = observer(function EditorFileTree() {
  const workspace = useWorkspace();
  const workspaceId = useWorkspaceId();
  const taskView = useTaskComposition();
  const tabLayout = useTabLayout();
  const editorView = taskView.editorView;
  const files = editorView.files;
  const openConfirmActionModal = useOpenModal('confirmActionModal');
  const [searchQuery, setSearchQuery] = useState('');
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusRequest = editorView.fileSearchFocusRequest;
  const expandedPaths = editorView.expandedPaths;
  const activeFile = tabLayout.focusedPane.activeResourceOfKind<FileTabResource>('file');
  const openedPaths = useMemo(() => new Set(editorView.openFilePaths), [editorView.openFilePaths]);
  const { rootNodes, childrenById } = useMemo(
    () => mapFileTreeData(files?.rootNodes ?? [], files?.childrenById ?? new Map()),
    [files?.childrenById, files?.rootNodes]
  );

  const setSearchInputRef = useCallback(
    (input: HTMLInputElement | null) => {
      searchInputRef.current = input;
      if (!input || focusRequest === 0) return;
      input.focus();
      input.select();
    },
    [focusRequest]
  );

  React.useEffect(() => {
    if (focusRequest === 0) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [focusRequest]);

  React.useEffect(() => {
    files?.reconcileVisibleScopes(expandedPaths);
  }, [expandedPaths, files]);

  const openFile = (path: string, preview: boolean) => {
    tabLayout.open('file', { path }, { preview });
  };

  const handleCreateFile = async (parentPath: string, name: string) => {
    if (!files) return;
    const path = joinFileTreePath(parentPath, name);
    const result = await files.createFile(path);
    if (!result.success) {
      toast({
        title: 'Create failed',
        description: resultErrorMessage(result.error as ResultLikeError),
        variant: 'destructive',
      });
      return;
    }
    openFile(path, false);
    toast({ title: 'File created' });
  };

  const handleCreateDirectory = async (parentPath: string, name: string) => {
    if (!files) return;
    const path = joinFileTreePath(parentPath, name);
    const result = await files.createDirectory(path);
    if (!result.success) {
      toast({
        title: 'Create failed',
        description: resultErrorMessage(result.error as ResultLikeError),
        variant: 'destructive',
      });
      return;
    }
    editorView.expandPath(path);
    toast({ title: 'Folder created' });
  };

  const handleRename = async (node: FileTreeNode, name: string) => {
    if (!files) return;
    const targetPath = joinFileTreePath(node.parentPath ?? '', name);
    const result = await files.rename(node.path, name);
    if (!result.success) {
      toast({
        title: 'Rename failed',
        description: resultErrorMessage(result.error as ResultLikeError),
        variant: 'destructive',
      });
      return;
    }
    await editorView.retargetOpenFiles(node.path, targetPath);
    setRenamePath(null);
    toast({ title: node.type === 'directory' ? 'Folder renamed' : 'File renamed' });
  };

  const handleMove = async (sourcePath: string, targetDirPath: string) => {
    if (!files) return;
    const targetPath = joinFileTreePath(targetDirPath, basenameFromPath(sourcePath));
    const result = await files.move(sourcePath, targetDirPath);
    if (!result.success) {
      toast({
        title: 'Move failed',
        description: resultErrorMessage(result.error as ResultLikeError),
        variant: 'destructive',
      });
      return;
    }
    await editorView.retargetOpenFiles(sourcePath, targetPath);
    toast({ title: 'Item moved' });
  };

  const closeDeletedFileTabs = (node: FileTreeNode) => {
    const closesDescendants = node.type === 'directory' || isExpandableFileTreeNode(node);
    for (const { pane } of taskView.paneLayout.groups) {
      for (const tab of pane.resolvedTabs) {
        if (tab.kind !== 'file') continue;
        const resource = tab.resource as FileTabResource;
        if (isPathWithin(resource.path, node.path, closesDescendants))
          void pane.closeTab(tab.tabId);
      }
    }
  };

  const confirmDelete = (node: FileTreeNode) => {
    void (async () => {
      if (!files) return;
      const outcome = await openConfirmActionModal({
        title:
          node.type === 'directory'
            ? 'Delete folder?'
            : node.type === 'symlink'
              ? 'Delete link?'
              : 'Delete file?',
        description:
          node.type === 'directory'
            ? `"${node.path}" and all of its contents will be deleted from the workspace.`
            : node.type === 'symlink'
              ? `"${node.path}" will be removed from the workspace. Its target will not be deleted.`
              : `"${node.path}" will be deleted from the workspace.`,
        confirmLabel: 'Delete',
        variant: 'destructive',
      });
      if (!outcome.success) return;
      const result = await files.deleteEntry(node.path, node.type === 'directory');
      if (!result.success) {
        await files.registerDir(node.parentPath ?? workspace.path, true);
        toast({
          title: 'Delete failed',
          description: resultErrorMessage(result.error as ResultLikeError),
          variant: 'destructive',
        });
        return;
      }
      closeDeletedFileTabs(node);
      toast({
        title:
          node.type === 'directory'
            ? 'Folder deleted'
            : node.type === 'symlink'
              ? 'Link deleted'
              : 'File deleted',
      });
    })();
  };

  const copyFile = async (node: FileTreeNode) => {
    if (!isOpenableFileTreeNode(node)) return;
    try {
      const client = await getEditorClient();
      const result = await client.fs.readText({
        ...editorFilePath(workspaceId, workspace.path, node.path),
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

  const copyPath = async (node: FileTreeNode) => {
    try {
      const client = await getEditorClient();
      const result = await client.fs.realPath(
        editorFilePath(workspaceId, workspace.path, node.path)
      );
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

  const copyRelativePath = async (node: FileTreeNode) => {
    try {
      await rpc.app.clipboardWriteText(relativeToWorkspace(workspace.path, node.path));
      toast({ title: 'Relative path copied' });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: error instanceof Error ? error.message : 'The path could not be copied.',
        variant: 'destructive',
      });
    }
  };

  const revealInFileManager = async (node: FileTreeNode) => {
    try {
      const result = await rpc.app.showWorkspaceItemInFolder({
        workspaceId,
        relativePath: relativeToWorkspace(workspace.path, node.path),
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

  const getContextMenuItems = (node: FileTreeNode): FileTreeContextMenuItem[] => {
    const items: FileTreeContextMenuItem[] = [];
    if (isOpenableFileTreeNode(node)) {
      items.push({
        id: 'copy-file',
        label: 'Copy',
        icon: <FileText size={14} />,
        onSelect: () => void copyFile(node),
      });
    }
    items.push(
      {
        id: 'copy-path',
        label: 'Copy path',
        icon: <Copy size={14} />,
        onSelect: () => void copyPath(node),
      },
      {
        id: 'copy-relative-path',
        label: 'Copy relative path',
        icon: <Copy size={14} />,
        onSelect: () => void copyRelativePath(node),
      }
    );
    if (!workspace.sshConnectionId) {
      items.push({
        id: 'reveal',
        label: REVEAL_LABEL,
        icon: <FolderOpen size={14} />,
        onSelect: () => void revealInFileManager(node),
      });
    }
    items.push(
      {
        id: 'rename',
        label: 'Rename',
        icon: <FilePen size={14} />,
        onSelect: () => setRenamePath(node.path),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: <Trash2 size={14} />,
        variant: 'destructive',
        onSelect: () => confirmDelete(node),
      }
    );
    return items;
  };

  const renderHeader = (context: FileTreeHeaderContext) => (
    <FileTreeHeaderBar
      context={context}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      setSearchInputRef={setSearchInputRef}
    />
  );

  const content = searchQuery ? (
    <>
      <FileTreeHeaderBar
        context={{
          targetPath: workspace.path,
          startDraft: () => setSearchQuery(''),
          collapseAll: () => editorView.collapsePaths([...expandedPaths]),
          expandAll: () => {},
        }}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        setSearchInputRef={setSearchInputRef}
      />
      <FileContentSearchResults workspaceId={workspaceId} query={searchQuery} />
    </>
  ) : (
    <FileTree
      rootPath={workspace.path}
      rootNodes={rootNodes}
      childrenById={childrenById}
      expandedPaths={expandedPaths}
      selectedPath={activeFile?.path ?? null}
      openedPaths={openedPaths}
      isLoading={files?.isLoading ?? true}
      error={files?.error}
      compactChains
      renamePath={renamePath}
      renderHeader={renderHeader}
      onCollapseAll={() => editorView.collapsePaths([...expandedPaths])}
      onToggleExpand={(node, expanded) => {
        if (expanded) {
          editorView.expandPath(node.path);
          if (files && isExpandableFileTreeNode(node) && !files.loadedPaths.has(node.path)) {
            void files.registerDir(node.path);
          }
        } else {
          editorView.collapsePath(node.path);
        }
      }}
      onRequestExpand={(path) => {
        editorView.expandPath(path);
        void files?.registerDir(path);
      }}
      onSelect={() => {}}
      onOpenFile={(node, options) => openFile(node.path, options.preview)}
      onCreateFile={handleCreateFile}
      onCreateDirectory={handleCreateDirectory}
      onRenameSubmit={handleRename}
      onRenameCancel={() => setRenamePath(null)}
      getContextMenuItems={getContextMenuItems}
      renderIcon={(node) => {
        if (node.type === 'file') return <FileIcon filename={node.name} size={12} />;
        if (node.type === 'symlink') return <Link2 size={12} />;
        return null;
      }}
      getRowState={(node) => rowStateForNode(node, workspace.path, workspace)}
      dnd={
        files
          ? {
              canDrop: (source, targetDir) =>
                canMoveNode(source.path, targetDir?.path ?? workspace.path, workspace.path),
              onMove: handleMove,
              onDropExternal: (dataTransfer, targetDirPath) => {
                const sourceFiles = Array.from(dataTransfer.files);
                if (sourceFiles.length === 0) return;
                void importLocalFiles({
                  files,
                  workspaceId,
                  workspacePath: workspace.path,
                  sourceFiles,
                  destDirPath: targetDirPath,
                });
              },
              onDragStart: (node, dataTransfer) => {
                setDraggedWorkspaceFile(dataTransfer, {
                  workspaceId,
                  targetPath: node.path,
                  targetPlatform: workspace.sshConnectionId ? 'linux' : undefined,
                });
              },
              onDragEnd: () => clearDraggedWorkspaceFile(),
            }
          : undefined
      }
    />
  );

  return <div className="flex h-full flex-col overflow-hidden">{content}</div>;
});

function FileTreeHeaderBar({
  context,
  searchQuery,
  setSearchQuery,
  setSearchInputRef,
}: {
  context: FileTreeHeaderContext;
  searchQuery: string;
  setSearchQuery(value: string): void;
  setSearchInputRef(input: HTMLInputElement | null): void;
}) {
  return (
    <div className="shrink-0 border-b border-border px-2 py-1.5">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            ref={setSearchInputRef}
            value={searchQuery}
            maxLength={FILE_SEARCH_MAX_QUERY_LENGTH}
            aria-label="Search"
            placeholder="Search"
            className="h-7 border-0 bg-transparent pr-7 pl-7 text-xs shadow-none hover:bg-background-1 focus-visible:bg-background-1 focus-visible:ring-1"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              if (searchQuery) setSearchQuery('');
              else event.currentTarget.blur();
            }}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear file content search"
              className="text-muted-foreground absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm hover:text-foreground"
              onClick={() => setSearchQuery('')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <HeaderAction label="New file" onClick={() => context.startDraft('file')}>
          <FilePlus className="size-3.5" />
        </HeaderAction>
        <HeaderAction label="New folder" onClick={() => context.startDraft('directory')}>
          <FolderPlus className="size-3.5" />
        </HeaderAction>
        <HeaderAction label="Collapse all" onClick={context.collapseAll}>
          <CopyMinus className="size-3.5" />
        </HeaderAction>
      </div>
    </div>
  );
}

function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-background-1 hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function mapFileTreeData(
  roots: readonly RenderableFileNode[],
  children: Map<string | null, RenderableFileNode[]>
): { rootNodes: FileTreeNode[]; childrenById: ChildrenById } {
  const mappedChildren = new Map<string | null, FileTreeNode[]>();
  for (const [parentId, entries] of children) {
    mappedChildren.set(parentId, entries.map(toFileTreeNode));
  }
  return {
    rootNodes: roots.map(toFileTreeNode),
    childrenById: mappedChildren,
  };
}

function toFileTreeNode(node: RenderableFileNode): FileTreeNode {
  return {
    id: node.id,
    path: node.path,
    name: node.name,
    parentId: node.parentId,
    parentPath: node.parentPath,
    depth: node.depth,
    type: node.type,
    symlink: Boolean(node.symlink),
    symlinkTargetKind: node.symlink?.targetType,
    childrenLoaded: node.childrenLoaded,
    isHidden: node.isHidden,
    extension: node.extension,
  };
}

function rowStateForNode(
  node: FileTreeNode,
  workspacePath: string,
  workspace: ReturnType<typeof useWorkspace>
): FileTreeRowState | undefined {
  const relNodePath = relativeToWorkspace(workspacePath, node.path);
  const fileStatus = workspace
    .get(gitCheckoutStoreToken)
    .fileChanges?.find((change) => change.path === relNodePath)?.status;
  if (!fileStatus && !node.isHidden) return undefined;
  return {
    muted: node.isHidden || fileStatus === 'deleted',
    strikethrough: fileStatus === 'deleted',
    tone:
      fileStatus === 'added'
        ? 'success'
        : fileStatus === 'modified'
          ? 'warning'
          : fileStatus === 'deleted'
            ? 'error'
            : fileStatus === 'renamed'
              ? 'info'
              : undefined,
  };
}

function isPathWithin(path: string, deletedPath: string, closesDescendants: boolean) {
  return closesDescendants
    ? path === deletedPath || path.startsWith(`${deletedPath}/`)
    : path === deletedPath;
}

function basenameFromPath(path: string): string {
  return normalizeFileTreePath(path).slice(normalizeFileTreePath(path).lastIndexOf('/') + 1);
}
