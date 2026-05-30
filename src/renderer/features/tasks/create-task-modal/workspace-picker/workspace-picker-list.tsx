import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { type ChangeEvent, useCallback, useMemo, useRef } from 'react';
import type { Range } from '@tanstack/react-virtual';
import type { PickerItem } from './workspace-picker-items';
import {
  PickerHostRow,
  PickerRepoRowContent,
  PickerWorktreeRowContent,
  PickerRow,
} from './workspace-picker-rows';

const HOST_HEIGHT = 24;
const ROW_HEIGHT = 56;

// ---------------------------------------------------------------------------
// PickerSearchInput
// ---------------------------------------------------------------------------

export function PickerSearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative flex h-9 shrink-0 items-center border-b border-border px-2.5">
      <Search className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-foreground-muted" />
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-transparent pl-6 text-sm outline-none placeholder:text-foreground-passive"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspacePickerList
// ---------------------------------------------------------------------------

export function WorkspacePickerList({
  items,
  mode,
  selectedValue,
  onSelect,
}: {
  items: PickerItem[];
  mode: 'repo' | 'worktree';
  selectedValue: string | null;
  onSelect: (value: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeStickyIndexRef = useRef(0);

  const stickyIndexes = useMemo(
    () => items.flatMap((item, i) => (item.type === 'host' ? [i] : [])),
    [items]
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]?.type === 'host' ? HOST_HEIGHT : ROW_HEIGHT),
    rangeExtractor: useCallback(
      (range: Range) => {
        activeStickyIndexRef.current =
          [...stickyIndexes].reverse().find((i) => range.startIndex >= i) ?? 0;
        return [...new Set([activeStickyIndexRef.current, ...defaultRangeExtractor(range)])].sort(
          (a, b) => a - b
        );
      },
      [stickyIndexes]
    ),
    overscan: 3,
  });

  return (
    <div ref={scrollRef} className="max-h-72 overflow-y-auto" role="listbox">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const item = items[vRow.index]!;
          const isActiveSticky = activeStickyIndexRef.current === vRow.index;

          const positionStyle: React.CSSProperties = isActiveSticky
            ? { position: 'sticky', top: 0, zIndex: 1 }
            : { position: 'absolute', top: 0, transform: `translateY(${vRow.start}px)`, zIndex: 0 };

          if (item.type === 'host') {
            return (
              <div
                key={vRow.key}
                style={{ ...positionStyle, width: '100%', height: vRow.size }}
              >
                <PickerRow depth={0} isSelected={false} isSelectable={false}>
                  <PickerHostRow item={item} />
                </PickerRow>
              </div>
            );
          }

          if (item.type === 'repo') {
            const isSelected =
              mode === 'repo'
                ? selectedValue === item.instance.id
                : !!item.mainEntry?.path && selectedValue === item.mainEntry.path;
            const isSelectable = mode === 'repo' || !!item.mainEntry?.path;
            const handleClick =
              mode === 'repo'
                ? () => onSelect(item.instance.id)
                : item.mainEntry?.path
                  ? () => onSelect(item.mainEntry!.path)
                  : undefined;

            return (
              <div
                key={vRow.key}
                style={{ ...positionStyle, width: '100%', height: vRow.size }}
              >
                <PickerRow
                  depth={1}
                  isSelected={isSelected}
                  isSelectable={isSelectable}
                  onClick={handleClick}
                >
                  <PickerRepoRowContent item={item} />
                </PickerRow>
              </div>
            );
          }

          // worktree
          const isSelected = selectedValue === item.entry.path;
          return (
            <div
              key={vRow.key}
              style={{ ...positionStyle, width: '100%', height: vRow.size }}
            >
              <PickerRow
                depth={2}
                isSelected={isSelected}
                isSelectable
                onClick={() => onSelect(item.entry.path)}
              >
                <PickerWorktreeRowContent item={item} />
              </PickerRow>
            </div>
          );
        })}
      </div>
    </div>
  );
}
