import { useMemo, useState, type ReactNode } from 'react';
import { ListFilterButton } from '@core/primitives/ui/browser/components/list-filters/list-filter-button';
import { ListFilterOptionList } from '@core/primitives/ui/browser/components/list-filters/list-filter-option-list';
import type { ListFilterOption } from '@core/primitives/ui/browser/components/list-filters/types';
import { Input } from '@core/primitives/ui/browser/input';

interface ListFilterSearchableSelectProps<T extends string> {
  label: string;
  items: readonly ListFilterOption<T>[];
  selected: T | null;
  onChange: (value: T | null) => void;
  renderLeading?: (item: ListFilterOption<T>) => ReactNode;
  searchPlaceholder?: string;
}

export function ListFilterSearchableSelect<T extends string>({
  label,
  items,
  selected,
  onChange,
  renderLeading,
  searchPlaceholder,
}: ListFilterSearchableSelectProps<T>) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () => items.filter((item) => item.label.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  return (
    <ListFilterButton label={label} active={selected !== null} disabled={items.length === 0}>
      <Input
        className="mb-1 h-7 text-xs"
        placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        autoFocus
      />
      <ListFilterOptionList
        items={filtered}
        isSelected={(value) => selected === value}
        onSelect={(value) => onChange(selected === value ? null : value)}
        renderLeading={renderLeading}
      />
    </ListFilterButton>
  );
}
