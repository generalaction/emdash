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

export interface HierarchicalListProps<T> {
  nodes: readonly HierarchicalListNode<T>[];
  renderItem: (
    node: HierarchicalListNode<T>,
    ctx: HierarchicalListRenderContext
  ) => React.ReactNode;
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

function HierarchicalList<T>({
  nodes,
  renderItem,
  selectedIds,
  onSelectedIdsChange,
  estimateSize = 32,
  emptySlot,
  className,
}: HierarchicalListProps<T>) {
  const rows = React.useMemo(() => flattenTree(nodes), [nodes]);
  const orderedIds = React.useMemo(() => rows.map((row) => row.node.id), [rows]);
  const selection = useHierarchicalSelection(orderedIds, { selectedIds, onSelectedIdsChange });

  return (
    <ListView className={cx(styles.root, className)}>
      <ListView.Body>
        <ListView.List
          items={rows}
          getItemKey={(row) => row.node.id}
          estimateSize={estimateSize}
          emptySlot={emptySlot}
          renderItem={(row, index) => {
            const { node, depth, hasChildren } = row;

            return (
              <ListView.Row
                interactive
                selected={selection.isSelected(node.id)}
                isLast={index === rows.length - 1}
                onClick={(event) => selection.handleClick(node.id, event)}
              >
                <div className={styles.rowContent} style={{ paddingLeft: `${depth * 1.25}rem` }}>
                  <div className={styles.content}>{renderItem(node, { depth, hasChildren })}</div>
                </div>
              </ListView.Row>
            );
          }}
        />
      </ListView.Body>
    </ListView>
  );
}

export { HierarchicalList };
