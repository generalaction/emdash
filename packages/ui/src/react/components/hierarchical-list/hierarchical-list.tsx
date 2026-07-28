import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { ListView } from '../../patterns/list-view';
import { useHierarchicalSelection } from './use-hierarchical-selection';
import * as styles from './hierarchical-list.css';

export interface HierarchicalListNode<T> {
  id: string;
  data: T;
  children?: readonly HierarchicalListNode<T>[];
}

export interface HierarchicalListRenderContext {
  depth: number;
  hasChildren: boolean;
}

export interface HierarchicalListRowCells {
  icon: React.ReactNode;
  path: React.ReactNode;
  gitStatus?: React.ReactNode;
  storage: React.ReactNode;
  usage: React.ReactNode;
}

export interface HierarchicalListProps<T> {
  nodes: readonly HierarchicalListNode<T>[];
  renderCells: (
    node: HierarchicalListNode<T>,
    ctx: HierarchicalListRenderContext
  ) => HierarchicalListRowCells;
  selectedIds?: ReadonlySet<string>;
  onSelectedIdsChange?: (ids: ReadonlySet<string>) => void;
  estimateSize?: number;
  emptySlot?: React.ReactNode;
  className?: string;
}

interface HierarchicalListRow<T> {
  node: HierarchicalListNode<T>;
  depth: number;
  hasChildren: boolean;
}

export interface HierarchicalListCellProps extends React.HTMLAttributes<HTMLDivElement> {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}

function flattenTree<T>(
  nodes: readonly HierarchicalListNode<T>[],
  depth = 0,
  rows: HierarchicalListRow<T>[] = []
): HierarchicalListRow<T>[] {
  for (const node of nodes) {
    const hasChildren = (node.children?.length ?? 0) > 0;
    rows.push({ node, depth, hasChildren });
    if (node.children) {
      flattenTree(node.children, depth + 1, rows);
    }
  }

  return rows;
}

function HierarchicalListCell({
  primary,
  secondary,
  className,
  ...props
}: HierarchicalListCellProps) {
  return (
    <div className={cx(styles.cell, className)} {...props}>
      <div className={styles.cellPrimary}>{primary}</div>
      {secondary !== undefined && <div className={styles.cellSecondary}>{secondary}</div>}
    </div>
  );
}

function HierarchicalList<T>({
  nodes,
  renderCells,
  selectedIds,
  onSelectedIdsChange,
  estimateSize = 52,
  emptySlot,
  className,
}: HierarchicalListProps<T>) {
  const rows = React.useMemo(() => flattenTree(nodes), [nodes]);
  const orderedIds = React.useMemo(() => rows.map((row) => row.node.id), [rows]);
  const selection = useHierarchicalSelection(orderedIds, { selectedIds, onSelectedIdsChange });

  return (
    <ListView className={cx(styles.root, className)}>
      <div className={cx(styles.headerRow, styles.rowGrid)}>
        <div aria-hidden />
        <div>Path</div>
        <div>Git status</div>
        <div>Storage</div>
        <div>Usage</div>
      </div>
      <ListView.Body>
        <ListView.List
          items={rows}
          getItemKey={(row) => row.node.id}
          estimateSize={estimateSize}
          emptySlot={emptySlot}
          renderItem={(row, index) => {
            const { node, depth, hasChildren } = row;
            const cells = renderCells(node, { depth, hasChildren });

            return (
              <ListView.Row
                interactive
                selected={selection.isSelected(node.id)}
                isLast={index === rows.length - 1}
                onClick={(event) => selection.handleClick(node.id, event)}
              >
                <div className={styles.rowGrid}>
                  <div className={styles.pathRegion} style={{ paddingLeft: `${depth * 1.25}rem` }}>
                    <span className={styles.iconTile} aria-hidden>
                      {cells.icon}
                    </span>
                    {cells.path}
                  </div>
                  <div>{cells.gitStatus}</div>
                  <div>{cells.storage}</div>
                  <div>{cells.usage}</div>
                </div>
              </ListView.Row>
            );
          }}
        />
      </ListView.Body>
    </ListView>
  );
}

export { HierarchicalList, HierarchicalListCell };
