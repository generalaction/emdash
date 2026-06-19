import { CheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ListFilterOption } from '@renderer/lib/components/list-filters/types';

interface ListFilterOptionListProps<T extends string> {
  items: readonly ListFilterOption<T>[];
  isSelected: (value: T) => boolean;
  onSelect: (value: T) => void;
  renderLeading?: (item: ListFilterOption<T>) => ReactNode;
  emptyLabel?: string;
  className?: string;
}

export function ListFilterOptionList<T extends string>({
  items,
  isSelected,
  onSelect,
  renderLeading,
  emptyLabel = 'No results',
  className = 'max-h-52 overflow-y-auto',
}: ListFilterOptionListProps<T>) {
  if (items.length === 0) {
    return <p className="text-muted-foreground px-2 py-3 text-center text-xs">{emptyLabel}</p>;
  }

  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item.value}>
          <button
            type="button"
            className="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
            onClick={() => onSelect(item.value)}
          >
            {renderLeading?.(item)}
            <span className="flex-1 truncate text-left">{item.label}</span>
            {isSelected(item.value) ? (
              <CheckIcon className="size-3.5 shrink-0 text-foreground" />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
