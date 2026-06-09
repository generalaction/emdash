import { useMemo, useState, type ReactNode } from 'react';
import { ListFilterButton } from '@renderer/lib/components/list-filters/list-filter-button';
import { ListFilterOptionList } from '@renderer/lib/components/list-filters/list-filter-option-list';
import type { ListFilterOption } from '@renderer/lib/components/list-filters/types';
import { Input } from '@renderer/lib/ui/input';

interface ListFilterMultiSelectProps<T extends string> {
  label: string;
  items: readonly ListFilterOption<T>[];
  selected: T[];
  onChange: (values: T[]) => void;
  renderLeading?: (item: ListFilterOption<T>) => ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function ListFilterMultiSelect<T extends string>({
  label,
  items,
  selected,
  onChange,
  renderLeading,
  searchable = true,
  searchPlaceholder,
}: ListFilterMultiSelectProps<T>) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!searchable) return items;
    return items.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()));
  }, [items, search, searchable]);

  const toggle = (value: T) =>
    onChange(
      selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value]
    );

  return (
    <ListFilterButton label={label} active={selected.length > 0} disabled={items.length === 0}>
      {searchable ? (
        <Input
          className="mb-1 h-7 text-xs"
          placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
      ) : null}
      <ListFilterOptionList
        items={filtered}
        isSelected={(value) => selected.includes(value)}
        onSelect={toggle}
        renderLeading={renderLeading}
      />
    </ListFilterButton>
  );
}
