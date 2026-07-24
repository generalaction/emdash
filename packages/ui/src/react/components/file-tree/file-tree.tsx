import { cx } from '@styles/utilities/cx';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  Link2Icon,
  Loader2Icon,
} from 'lucide-react';
import * as React from 'react';
import { resolveFileIconClass } from '../../lib/file-icons';
import { TreeView, type TreeNode, type TreeRow } from '../../patterns/tree-view';
import { ContextMenu } from '../../primitives/context-menu';
import {
  FileTreeHeader,
  type FileTreeDraftKind,
  type FileTreeHeaderContext,
} from './file-tree-header';
import {
  ancestorPathsFor,
  buildFlatFileRows,
  canMoveNode,
  creationTargetPath,
  isExpandableFileTreeNode,
  isOpenableFileTreeNode,
  normalizeFileTreePath,
  resolveDropTargetDir,
  sortFileNodes,
  type ChildrenById,
  type FileTreeFlatRow,
  type FileTreeNode,
} from './file-tree-utils';
import * as styles from './file-tree.css';

const ROW_HEIGHT = 28;
const ROW_GAP = 2;
const HOVER_EXPAND_MS = 500;
const INTERNAL_DRAG_MIME = 'application/x-emdash-file-tree-path';

export interface FileTreeContextMenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  onSelect(node: FileTreeNode): void;
}

export interface FileTreeDndSpec {
  canDrag?: (node: FileTreeNode) => boolean;
  canDrop?: (source: FileTreeNode, targetDir: FileTreeNode | null) => boolean;
  onMove(sourcePath: string, targetDirPath: string): void | Promise<void>;
  onDropExternal?: (dataTransfer: DataTransfer, targetDirPath: string) => void;
}

export interface FileTreeRowState {
  muted?: boolean;
  strikethrough?: boolean;
}

export interface FileTreeIconState {
  expanded: boolean;
}

export interface FileTreeProps {
  rootPath?: string;
  rootNodes: readonly FileTreeNode[];
  childrenById: ChildrenById;
  expandedPaths?: ReadonlySet<string>;
  selectedPath?: string | null;
  openedPaths?: ReadonlySet<string>;
  isLoading?: boolean;
  error?: React.ReactNode;
  mode?: 'tree' | 'flat';
  compactChains?: boolean;
  defaultExpanded?: 'all' | 'none';
  dnd?: FileTreeDndSpec;
  className?: string;
  onCollapseAll?: () => void;
  onExpandAll?: (directoryPaths: ReadonlySet<string>) => void;
  onToggleExpand?: (node: FileTreeNode, expanded: boolean) => void;
  onSelect?: (node: FileTreeNode | null) => void;
  onOpenFile?: (node: FileTreeNode) => void;
  onCreateFile?: (parentPath: string, name: string) => void | Promise<void>;
  onCreateDirectory?: (parentPath: string, name: string) => void | Promise<void>;
  onRequestExpand?: (path: string) => void;
  onRowHover?: (node: FileTreeNode) => void;
  getContextMenuItems?: (node: FileTreeNode) => readonly FileTreeContextMenuItem[] | null;
  renderIcon?: (node: FileTreeNode, state: FileTreeIconState) => React.ReactNode;
  renderHeader?: (context: FileTreeHeaderContext) => React.ReactNode;
  renderDecoration?: (node: FileTreeNode) => React.ReactNode;
  getRowState?: (node: FileTreeNode) => FileTreeRowState | undefined;
}

interface DraftState {
  kind: FileTreeDraftKind;
  parentPath: string;
}

type RenderableData =
  | { kind: 'node'; node: FileTreeNode; flatDirectory?: string }
  | { kind: 'draft'; draft: DraftState };

export function FileTree({
  rootPath = '',
  rootNodes,
  childrenById,
  expandedPaths,
  selectedPath,
  openedPaths,
  isLoading = false,
  error,
  mode = 'tree',
  compactChains = false,
  defaultExpanded = 'none',
  dnd,
  className,
  onCollapseAll,
  onExpandAll,
  onToggleExpand,
  onSelect,
  onOpenFile,
  onCreateFile,
  onCreateDirectory,
  onRequestExpand,
  onRowHover,
  getContextMenuItems,
  renderIcon,
  renderHeader,
  renderDecoration,
  getRowState,
}: FileTreeProps) {
  const normalizedRootPath = normalizeFileTreePath(rootPath);
  const allNodes = React.useMemo(
    () => collectNodes(rootNodes, childrenById),
    [childrenById, rootNodes]
  );
  const nodesByPath = React.useMemo(
    () => new Map(allNodes.map((node) => [normalizeFileTreePath(node.path), node])),
    [allNodes]
  );
  const directoryPaths = React.useMemo(
    () =>
      new Set(
        allNodes.filter(isExpandableFileTreeNode).map((node) => normalizeFileTreePath(node.path))
      ),
    [allNodes]
  );
  const [internalExpandedPaths, setInternalExpandedPaths] = React.useState<ReadonlySet<string>>(
    () => (defaultExpanded === 'all' ? directoryPaths : new Set())
  );
  const [draft, setDraft] = React.useState<DraftState | null>(null);
  const [dragSourcePath, setDragSourcePath] = React.useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = React.useState<string | null>(null);
  const [pendingMovePath, setPendingMovePath] = React.useState<string | null>(null);
  const hoverExpandTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (expandedPaths) return;
    setInternalExpandedPaths(defaultExpanded === 'all' ? directoryPaths : new Set());
  }, [defaultExpanded, directoryPaths, expandedPaths]);

  React.useEffect(() => () => clearHoverExpandTimer(hoverExpandTimerRef), []);

  const effectiveExpandedPaths = React.useMemo(
    () => normalizePathSet(expandedPaths ?? internalExpandedPaths),
    [expandedPaths, internalExpandedPaths]
  );
  const normalizedOpenedPaths = React.useMemo(
    () => normalizePathSet(openedPaths ?? new Set()),
    [openedPaths]
  );
  const normalizedSelectedPath = selectedPath ? normalizeFileTreePath(selectedPath) : null;
  const selectedNode = normalizedSelectedPath ? nodesByPath.get(normalizedSelectedPath) : undefined;
  const targetPath = creationTargetPath(selectedNode, normalizedRootPath);

  const treeNodes = React.useMemo(
    () =>
      mode === 'flat'
        ? buildFlatRenderableNodes(rootNodes, childrenById, draft)
        : buildRenderableTreeNodes(rootNodes, childrenById, draft, targetPath, normalizedRootPath),
    [childrenById, draft, mode, normalizedRootPath, rootNodes, targetPath]
  );

  const header =
    renderHeader === undefined ? (
      <FileTreeHeader
        targetPath={targetPath}
        startDraft={startDraft}
        collapseAll={collapseAll}
        expandAll={expandAll}
      />
    ) : (
      renderHeader({ targetPath, startDraft, collapseAll, expandAll })
    );

  if (isLoading) {
    return (
      <section className={cx(styles.root, className)} aria-label="File tree">
        {header}
        <FileTreeState>
          <Loader2Icon aria-hidden className={styles.spinner} />
          Loading files
        </FileTreeState>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cx(styles.root, className)} aria-label="File tree">
        {header}
        <FileTreeState error>{error}</FileTreeState>
      </section>
    );
  }

  const empty = rootNodes.length === 0 && !draft;

  return (
    <section className={cx(styles.root, className)} aria-label="File tree">
      {header}
      <div
        className={styles.body}
        onDragOver={(event) => handleDragOver(null, event)}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDropTargetPath(null);
        }}
        onDrop={(event) => handleDrop(null, event)}
      >
        {empty ? (
          <FileTreeState>Empty folder</FileTreeState>
        ) : (
          <TreeView
            nodes={treeNodes}
            expandedIds={effectiveExpandedPaths}
            compactChains={compactChains}
            estimateSize={ROW_HEIGHT}
            gap={ROW_GAP}
            overscan={8}
            className={styles.treeViewport}
            renderRow={(row) => renderTreeRow(row)}
          />
        )}
        {dropTargetPath === normalizedRootPath ? <div className={styles.rootDropTarget} /> : null}
      </div>
    </section>
  );

  function renderTreeRow(row: TreeRow<RenderableData>) {
    if (row.node.data.kind === 'draft') {
      return (
        <DraftRow
          draft={row.node.data.draft}
          depth={row.depth}
          onCommit={commitDraft}
          onCancel={() => setDraft(null)}
        />
      );
    }

    const node = row.node.data.node;
    const isExpanded = row.isExpanded;
    const isSelected = normalizeFileTreePath(node.path) === normalizedSelectedPath;
    const isOpened = normalizedOpenedPaths.has(normalizeFileTreePath(node.path));
    const state = getRowState?.(node);
    const menuItems = getContextMenuItems?.(node) ?? null;
    const icon = renderIcon ? renderIcon(node, { expanded: isExpanded }) : defaultIcon(node);
    const content = (
      <button
        type="button"
        className={styles.row}
        style={rowIndentStyle(row.depth)}
        draggable={dnd ? (dnd.canDrag?.(node) ?? true) : undefined}
        data-selected={isSelected || undefined}
        data-opened={!isSelected && isOpened ? true : undefined}
        data-drop-target={dropTargetPath === normalizeFileTreePath(node.path) || undefined}
        data-pending={pendingMovePath === normalizeFileTreePath(node.path) || undefined}
        onClick={() => handleNodeClick(node, isExpanded)}
        onMouseEnter={() => onRowHover?.(node)}
        onDragStart={(event) => handleDragStart(node, event)}
        onDragOver={(event) => handleDragOver(node, event)}
        onDragLeave={() => setDropTargetPath(null)}
        onDrop={(event) => handleDrop(node, event)}
        onDragEnd={() => {
          clearHoverExpandTimer(hoverExpandTimerRef);
          setDragSourcePath(null);
          setDropTargetPath(null);
        }}
      >
        {Array.from({ length: row.depth }, (_, level) => (
          <span
            key={level}
            className={styles.indentGuide}
            style={indentGuideStyle(level)}
            aria-hidden
          />
        ))}
        {isExpandableFileTreeNode(node) ? (
          <span className={styles.chevron} aria-hidden>
            {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </span>
        ) : (
          <span className={styles.spacer} aria-hidden />
        )}
        {icon ? (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className={styles.label}>
          <span
            className={cx(
              styles.name,
              state?.muted && styles.muted,
              state?.strikethrough && styles.strikethrough
            )}
          >
            {displayName(row)}
          </span>
          {row.node.data.flatDirectory ? (
            <span className={styles.secondary}>{row.node.data.flatDirectory}</span>
          ) : null}
        </span>
        {renderDecoration ? (
          <span className={styles.decoration}>{renderDecoration(node)}</span>
        ) : null}
      </button>
    );

    if (!menuItems?.length) return content;
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger className={styles.rowWrapper}>{content}</ContextMenu.Trigger>
        <ContextMenu.Content>
          {menuItems.map((item) => (
            <ContextMenu.Item
              key={item.id}
              disabled={item.disabled}
              variant={item.variant}
              onClick={() => item.onSelect(node)}
            >
              {item.icon}
              {item.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Root>
    );
  }

  function startDraft(kind: FileTreeDraftKind) {
    setDraft({ kind, parentPath: targetPath });
    if (targetPath) requestExpandPath(targetPath);
  }

  function collapseAll() {
    if (!expandedPaths) setInternalExpandedPaths(new Set());
    onCollapseAll?.();
  }

  function expandAll() {
    if (!expandedPaths) setInternalExpandedPaths(new Set(directoryPaths));
    onExpandAll?.(directoryPaths);
  }

  function handleNodeClick(node: FileTreeNode, isExpanded: boolean) {
    onSelect?.(node);
    if (isExpandableFileTreeNode(node)) {
      setExpanded(node, !isExpanded);
      return;
    }
    if (isOpenableFileTreeNode(node)) onOpenFile?.(node);
  }

  function setExpanded(node: FileTreeNode, expanded: boolean) {
    const path = normalizeFileTreePath(node.path);
    // A compacted row stands for a chain of single-child directories, and it only
    // renders as expanded once every segment is expanded. Collapsing the deepest
    // segment is enough to close the row again.
    const paths = expanded ? [...ancestorPathsFor(path, normalizedRootPath), path] : [path];

    if (!expandedPaths) {
      setInternalExpandedPaths((current) => {
        const next = new Set(current);
        for (const target of paths) {
          if (expanded) next.add(target);
          else next.delete(target);
        }
        return next;
      });
    }

    if (!onToggleExpand) return;
    for (const target of paths) {
      const targetNode = target === path ? node : nodesByPath.get(target);
      if (targetNode) onToggleExpand(targetNode, expanded);
    }
  }

  function requestExpandPath(path: string) {
    const node = nodesByPath.get(normalizeFileTreePath(path));
    if (!node || !isExpandableFileTreeNode(node)) return;
    if (effectiveExpandedPaths.has(normalizeFileTreePath(node.path))) return;
    onRequestExpand?.(normalizeFileTreePath(path));
    setExpanded(node, true);
  }

  async function commitDraft(name: string) {
    if (!draft) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setDraft(null);
      return;
    }
    if (draft.kind === 'file') await onCreateFile?.(draft.parentPath, trimmed);
    else await onCreateDirectory?.(draft.parentPath, trimmed);
    setDraft(null);
  }

  function handleDragStart(node: FileTreeNode, event: React.DragEvent<HTMLButtonElement>) {
    if (!dnd || !(dnd.canDrag?.(node) ?? true)) {
      event.preventDefault();
      return;
    }
    const path = normalizeFileTreePath(node.path);
    setDragSourcePath(path);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(INTERNAL_DRAG_MIME, path);
    event.dataTransfer.setData('text/plain', path);
  }

  function handleDragOver(targetNode: FileTreeNode | null, event: React.DragEvent<HTMLElement>) {
    if (!dnd) return;
    const target = resolveDropTargetDir(targetNode, nodesByPath, normalizedRootPath);
    const sourcePath = dragSourcePath || event.dataTransfer.getData(INTERNAL_DRAG_MIME) || null;
    const canDrop = sourcePath ? canDropInternal(sourcePath, target) : Boolean(dnd.onDropExternal);
    if (!canDrop) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = sourcePath ? 'move' : 'copy';
    setDropTargetPath(target.targetDirPath);
    scheduleHoverExpand(target.targetDir);
  }

  function handleDrop(targetNode: FileTreeNode | null, event: React.DragEvent<HTMLElement>) {
    if (!dnd) return;
    const target = resolveDropTargetDir(targetNode, nodesByPath, normalizedRootPath);
    const sourcePath = dragSourcePath || event.dataTransfer.getData(INTERNAL_DRAG_MIME) || null;

    event.preventDefault();
    event.stopPropagation();
    clearHoverExpandTimer(hoverExpandTimerRef);
    setDropTargetPath(null);
    setDragSourcePath(null);

    if (sourcePath && canDropInternal(sourcePath, target)) {
      void moveInternal(sourcePath, target.targetDirPath);
      return;
    }

    if (!sourcePath && dnd.onDropExternal) {
      dnd.onDropExternal(event.dataTransfer, target.targetDirPath);
    }
  }

  function canDropInternal(
    sourcePath: string,
    target: { targetDir: FileTreeNode | null; targetDirPath: string }
  ) {
    const source = nodesByPath.get(normalizeFileTreePath(sourcePath));
    if (!source) return false;
    if (!canMoveNode(source.path, target.targetDirPath, normalizedRootPath)) return false;
    return dnd?.canDrop?.(source, target.targetDir) ?? true;
  }

  async function moveInternal(sourcePath: string, targetDirPath: string) {
    const normalizedSource = normalizeFileTreePath(sourcePath);
    setPendingMovePath(normalizedSource);
    try {
      await dnd?.onMove(normalizedSource, targetDirPath);
    } finally {
      setPendingMovePath(null);
    }
  }

  function scheduleHoverExpand(targetDir: FileTreeNode | null) {
    clearHoverExpandTimer(hoverExpandTimerRef);
    if (!targetDir || effectiveExpandedPaths.has(normalizeFileTreePath(targetDir.path))) return;
    hoverExpandTimerRef.current = setTimeout(() => {
      setExpanded(targetDir, true);
    }, HOVER_EXPAND_MS);
  }
}

function DraftRow({
  draft,
  depth,
  onCommit,
  onCancel,
}: {
  draft: DraftState;
  depth: number;
  onCommit(name: string): void | Promise<void>;
  onCancel(): void;
}) {
  const [value, setValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={cx(styles.row, styles.draftRow)} style={rowIndentStyle(depth)}>
      <span className={styles.spacer} aria-hidden />
      <span className={styles.icon} aria-hidden>
        {draft.kind === 'directory' ? <FolderIcon size={14} /> : <FileIcon size={12} />}
      </span>
      <input
        ref={inputRef}
        className={styles.draftInput}
        value={value}
        placeholder={draft.kind === 'directory' ? 'Folder name' : 'File name'}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={() => {
          if (!value.trim()) onCancel();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            void onCommit(value);
          }
        }}
      />
    </div>
  );
}

function FileTreeState({
  error = false,
  children,
}: {
  error?: boolean;
  children: React.ReactNode;
}) {
  return <div className={cx(styles.state, error && styles.stateError)}>{children}</div>;
}

function defaultIcon(node: FileTreeNode) {
  if (node.type === 'directory') return null;
  if (node.type === 'symlink') return <Link2Icon size={12} />;
  const iconClass = resolveFileIconClass(node.name);
  if (iconClass) return <i className={cx(styles.devicon, iconClass)} />;
  return <FileIcon className={styles.fileIcon} size={12} />;
}

function displayName(row: TreeRow<RenderableData>): string {
  if (row.node.data.kind !== 'node') return '';
  if (row.chain.length <= 1) return row.node.data.node.name;
  return row.chain
    .map((segment) => (segment.data.kind === 'node' ? segment.data.node.name : ''))
    .filter(Boolean)
    .join('/');
}

function buildRenderableTreeNodes(
  rootNodes: readonly FileTreeNode[],
  childrenById: ChildrenById,
  draft: DraftState | null,
  targetPath: string,
  rootPath: string
): TreeNode<RenderableData>[] {
  const sortedRoots = sortFileNodes(rootNodes);
  const roots =
    draft && targetPath === rootPath
      ? [
          draftTreeNode(draft),
          ...sortedRoots.map((node) => toRenderableTreeNode(node, childrenById, draft)),
        ]
      : sortedRoots.map((node) => toRenderableTreeNode(node, childrenById, draft));
  return roots;
}

function toRenderableTreeNode(
  node: FileTreeNode,
  childrenById: ChildrenById,
  draft: DraftState | null
): TreeNode<RenderableData> {
  if (!isExpandableFileTreeNode(node)) {
    return { id: normalizeFileTreePath(node.path), data: { kind: 'node', node } };
  }

  const children = sortFileNodes(childrenById.get(node.id) ?? []).map((child) =>
    toRenderableTreeNode(child, childrenById, draft)
  );
  const normalizedPath = normalizeFileTreePath(node.path);
  const nextChildren =
    draft && draft.parentPath === normalizedPath ? [draftTreeNode(draft), ...children] : children;

  return {
    id: normalizedPath,
    data: { kind: 'node', node },
    children: nextChildren,
  };
}

function buildFlatRenderableNodes(
  rootNodes: readonly FileTreeNode[],
  childrenById: ChildrenById,
  draft: DraftState | null
): TreeNode<RenderableData>[] {
  const rows = buildFlatFileRows(rootNodes, childrenById);
  const nodes = rows.map((row) => flatTreeNode(row));
  return draft ? [draftTreeNode(draft), ...nodes] : nodes;
}

function flatTreeNode(row: FileTreeFlatRow): TreeNode<RenderableData> {
  return {
    id: normalizeFileTreePath(row.node.path),
    data: { kind: 'node', node: row.node, flatDirectory: row.directory },
  };
}

function draftTreeNode(draft: DraftState): TreeNode<RenderableData> {
  return {
    id: `__draft__:${draft.kind}:${draft.parentPath}`,
    data: { kind: 'draft', draft },
  };
}

function collectNodes(
  rootNodes: readonly FileTreeNode[],
  childrenById: ChildrenById
): FileTreeNode[] {
  const nodes: FileTreeNode[] = [];
  const visit = (node: FileTreeNode) => {
    nodes.push(node);
    for (const child of childrenById.get(node.id) ?? []) visit(child);
  };
  for (const node of rootNodes) visit(node);
  return nodes;
}

function normalizePathSet(paths: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...paths].map(normalizeFileTreePath));
}

function rowIndentStyle(depth: number): React.CSSProperties {
  return {
    '--file-tree-row-indent': `${depth * 12 + 4}px`,
  } as React.CSSProperties;
}

function indentGuideStyle(level: number): React.CSSProperties {
  return {
    left: `${level * 12 + 11}px`,
  };
}

function clearHoverExpandTimer(ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (!ref.current) return;
  clearTimeout(ref.current);
  ref.current = null;
}
