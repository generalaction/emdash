import { HTMLElements, Reorder } from 'motion/react';
import React from 'react';

type Axis = 'x' | 'y';
type ReorderTag = keyof HTMLElements;

interface ReorderListProps<T> {
  items: T[];
  onReorder: (items: T[]) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  axis?: Axis;
  className?: string;
  itemClassName?: string;
  layoutScroll?: boolean;
  as?: ReorderTag;
  getKey?: (item: T, index: number) => string | number;
  children: (item: T, index: number) => React.ReactNode;
}

export function ReorderList<T>({
  items,
  onReorder,
  onDragStart,
  onDragEnd,
  axis = 'y',
  className,
  itemClassName,
  layoutScroll = true,
  as = 'div',
  getKey,
  children,
}: ReorderListProps<T>) {
  return (
    <Reorder.Group<T, typeof as>
      as={as}
      axis={axis}
      values={items}
      onReorder={onReorder}
      layoutScroll={layoutScroll}
      className={className}
    >
      {items.map((item, index) => (
        <Reorder.Item<T>
          key={getKey ? getKey(item, index) : index}
          value={item}
          className={itemClassName}
          transition={{ layout: { duration: 0 } }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {children(item, index)}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}

export default ReorderList;
