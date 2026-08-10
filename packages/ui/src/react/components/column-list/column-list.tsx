import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { ListView } from '../../patterns/list-view';
import * as styles from './column-list.css';

export interface ColumnListColumn<T> {
  /** Stable identifier, used as the React key for the cell. */
  id: string;
  /** CSS grid track size: '2.25rem', 'minmax(0, 1fr)', '9rem', etc. */
  width: string;
  /** Renders this column's cell for an item. */
  cell: (item: T, index: number) => React.ReactNode;
  /** Optional cross-axis alignment for this cell. */
  align?: 'start' | 'center' | 'end';
}

export interface ColumnListProps<T> {
  items: readonly T[];
  columns: readonly ColumnListColumn<T>[];
  getItemKey: (item: T, index: number) => string;
  onItemClick?: (item: T, index: number, event: React.MouseEvent<HTMLDivElement>) => void;
  estimateSize?: number;
  emptySlot?: React.ReactNode;
  className?: string;
}

export interface ColumnListCellProps extends React.HTMLAttributes<HTMLDivElement> {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}

function ColumnListCell({ primary, secondary, className, ...props }: ColumnListCellProps) {
  return (
    <div className={cx(styles.cell, className)} {...props}>
      <div className={styles.cellPrimary}>{primary}</div>
      {secondary !== undefined && <div className={styles.cellSecondary}>{secondary}</div>}
    </div>
  );
}

/**
 * @deprecated Use `CollectionView` from `@emdash/ui` patterns instead — the
 * canonical page-level list surface (this component's `columns` mode is a
 * drop-in). ColumnList is scheduled for deletion once its consumers migrate.
 */
function ColumnList<T>({
  items,
  columns,
  getItemKey,
  onItemClick,
  estimateSize = 60,
  emptySlot,
  className,
}: ColumnListProps<T>) {
  const listItems = React.useMemo(() => Array.from(items), [items]);
  const gridTemplate = React.useMemo(
    () => columns.map((column) => column.width).join(' '),
    [columns]
  );

  return (
    <ListView className={cx(styles.root, className)}>
      <ListView.Body>
        <ListView.List
          items={listItems}
          getItemKey={getItemKey}
          estimateSize={estimateSize}
          emptySlot={emptySlot}
          renderItem={(item, index) => (
            <ListView.Row
              bare
              className={styles.row}
              interactive={onItemClick !== undefined}
              isLast={index === listItems.length - 1}
              onClick={
                onItemClick !== undefined ? (event) => onItemClick(item, index, event) : undefined
              }
            >
              <div
                className={styles.rowGrid}
                style={
                  {
                    '--column-list-template': gridTemplate,
                  } as React.CSSProperties
                }
              >
                {columns.map((column) => (
                  <div key={column.id} className={styles.bodyCell} data-align={column.align}>
                    {column.cell(item, index)}
                  </div>
                ))}
              </div>
            </ListView.Row>
          )}
        />
      </ListView.Body>
    </ListView>
  );
}

export { ColumnList, ColumnListCell };
