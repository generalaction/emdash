import { CheckIcon } from 'lucide-react';
import { ListFilterButton } from '@renderer/lib/components/list-filters/list-filter-button';
import { ListFilterOptionList } from '@renderer/lib/components/list-filters/list-filter-option-list';
import type { ListFilterOption } from '@renderer/lib/components/list-filters/types';

interface ListFilterSingleSelectProps<T extends string> {
  label: string;
  items: readonly ListFilterOption<T>[];
  selected: T | null;
  onChange: (value: T | null) => void;
  clearLabel?: string;
  listClassName?: string;
}

export function ListFilterSingleSelect<T extends string>({
  label,
  items,
  selected,
  onChange,
  clearLabel,
  listClassName = 'max-h-64 overflow-y-auto',
}: ListFilterSingleSelectProps<T>) {
  return (
    <ListFilterButton label={label} active={selected !== null}>
      {clearLabel ? (
        <ul className={listClassName}>
          <li>
            <button
              type="button"
              className="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
              onClick={() => onChange(null)}
            >
              <span className="flex-1 truncate text-left">{clearLabel}</span>
              {selected === null ? (
                <CheckIcon className="size-3.5 shrink-0 text-foreground" />
              ) : null}
            </button>
          </li>
          {items.map((item) => (
            <li key={item.value}>
              <button
                type="button"
                className="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm"
                onClick={() => onChange(selected === item.value ? null : item.value)}
              >
                <span className="flex-1 truncate text-left">{item.label}</span>
                {selected === item.value ? (
                  <CheckIcon className="size-3.5 shrink-0 text-foreground" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ListFilterOptionList
          items={items}
          className={listClassName}
          isSelected={(value) => selected === value}
          onSelect={(value) => onChange(selected === value ? null : value)}
        />
      )}
    </ListFilterButton>
  );
}
