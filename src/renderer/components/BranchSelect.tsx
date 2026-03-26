import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';

export type BranchOption = {
  value: string;
  label: string;
};

/**
 * Pick best default: preferredValue if valid, else origin/main > main > first option.
 */
export function pickDefaultBranch(
  options: BranchOption[],
  preferredValue?: string
): string | undefined {
  if (options.length === 0) return undefined;

  if (preferredValue && options.some((opt) => opt.value === preferredValue)) {
    return preferredValue;
  }

  const defaults = ['origin/main', 'main', 'origin/master', 'master'];
  for (const branch of defaults) {
    if (options.some((opt) => opt.value === branch)) return branch;
  }

  return options[0].value;
}

type BranchSelectVariant = 'default' | 'ghost';

interface BranchSelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  options: BranchOption[];
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  variant?: BranchSelectVariant;
  onOpenChange?: (open: boolean) => void;
  icon?: React.ReactNode;
}

const ROW_HEIGHT = 32;
const MAX_LIST_HEIGHT = 256;
const MAX_DISPLAYED_OPTIONS = 50;
const EMPTY_BRANCH_VALUE = '__branch_select_empty__';

/**
 * Filter and cap options for display. Ensures the selected value is always
 * included in the result so Radix can render it in the trigger.
 */
export function filterBranchOptions(
  options: BranchOption[],
  searchTerm: string,
  selectedValue?: string
): { displayed: BranchOption[]; hasMore: boolean; hasKnownSelection: boolean } {
  const query = searchTerm.trim().toLowerCase();
  const limit = MAX_DISPLAYED_OPTIONS;
  const matches: BranchOption[] = [];
  let selectedFound = false;
  let totalMatches = 0;
  let hasMore = false;

  for (const option of options) {
    const isMatch = !query || option.label.toLowerCase().includes(query);
    if (isMatch) {
      totalMatches++;
      if (matches.length < limit) {
        matches.push(option);
      } else {
        hasMore = true;
      }
    }
    if (selectedValue && option.value === selectedValue) {
      selectedFound = true;
    }
    if (hasMore && (selectedFound || !selectedValue)) break;
  }

  // Radix Select can only display the trigger text for a value if a matching
  // <SelectItem> exists in the DOM. If the selected branch falls past the cap,
  // prepend it so the trigger doesn't render blank.
  if (selectedValue && selectedFound && !matches.some((o) => o.value === selectedValue)) {
    const selectedOption = options.find((o) => o.value === selectedValue);
    if (selectedOption) matches.unshift(selectedOption);
  }

  return {
    displayed: matches,
    hasMore,
    hasKnownSelection: selectedFound,
  };
}

const BranchSelect: React.FC<BranchSelectProps> = ({
  value,
  onValueChange,
  options,
  disabled = false,
  isLoading = false,
  placeholder,
  variant = 'default',
  onOpenChange,
  icon,
}) => {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Freeze options while dropdown is open so Radix doesn't lose the
  // selected value when the list changes. Allow the initial load through
  // (snapshot has ≤1 item) so branches appear on first open.
  const [snapshot, setSnapshot] = useState(options);
  useEffect(() => {
    if (!open || snapshot.length <= 1) {
      setSnapshot(options);
    }
  }, [open, options]); // eslint-disable-line react-hooks/exhaustive-deps
  const stableOptions = open ? snapshot : options;

  const navigationKeys = useMemo(
    () => new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Escape']),
    []
  );

  const {
    displayed: displayedOptions,
    hasMore,
    hasKnownSelection,
  } = useMemo(
    () => filterBranchOptions(stableOptions, searchTerm, value),
    [stableOptions, searchTerm, value]
  );

  const estimatedListHeight = Math.min(
    MAX_LIST_HEIGHT,
    Math.max(displayedOptions.length, 1) * ROW_HEIGHT
  );

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearchTerm('');
    }
  }, [open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange]
  );

  const defaultPlaceholder = isLoading ? 'Loading...' : 'Select branch';
  const triggerPlaceholder = placeholder ?? defaultPlaceholder;
  const selectedValue = hasKnownSelection ? (value as string) : EMPTY_BRANCH_VALUE;

  const triggerClassName =
    variant === 'ghost'
      ? 'h-auto border-none bg-transparent p-0 text-xs text-muted-foreground shadow-none hover:text-foreground focus:ring-0 [&>svg]:ml-0.5 [&>svg]:h-3 [&>svg]:w-3'
      : 'h-8 w-full gap-2 px-3 text-xs font-medium shadow-none sm:w-auto';

  return (
    <Select
      value={selectedValue}
      onValueChange={(v) => {
        // Radix can emit the hidden placeholder item's value when options
        // change while the dropdown is open. Filter it out so the parent
        // never receives the sentinel as a real selection.
        if (v && v !== EMPTY_BRANCH_VALUE) onValueChange(v);
      }}
      disabled={disabled || (isLoading && options.length === 0)}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <SelectTrigger className={triggerClassName}>
        {icon}
        <SelectValue placeholder={triggerPlaceholder} />
      </SelectTrigger>
      <SelectContent
        className="[&>[data-radix-select-scroll-down-button]]:hidden [&>[data-radix-select-scroll-up-button]]:hidden"
        style={{ minWidth: '320px' }}
      >
        <SelectItem value={EMPTY_BRANCH_VALUE} disabled className="hidden">
          {triggerPlaceholder}
        </SelectItem>
        <div className="px-2 pb-2 pt-2" onPointerDown={(event) => event.stopPropagation()}>
          <Input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (!navigationKeys.has(event.key)) {
                event.stopPropagation();
              }
            }}
            placeholder="Search branches"
            className="bg-popover px-2 py-1 text-sm"
          />
        </div>
        {isLoading && (
          <div className="py-1.5 pl-2 pr-8 text-xs text-muted-foreground">
            Fetching latest branches...
          </div>
        )}
        <ScrollArea
          className="w-full"
          style={{
            height: `${estimatedListHeight}px`,
            maxHeight: `${MAX_LIST_HEIGHT}px`,
          }}
        >
          <div className="space-y-0 pr-3">
            {displayedOptions.length > 0 ? (
              displayedOptions.map((option) => (
                // Radix SelectItem steals focus on hover via onPointerMove. Suppress it to
                // keep focus in the search input. See: github.com/radix-ui/primitives/issues/2193
                <SelectItem
                  key={option.value}
                  value={option.value}
                  onPointerMove={(e) => e.preventDefault()}
                  onPointerLeave={(e) => e.preventDefault()}
                >
                  {option.label}
                </SelectItem>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">No matching branches</div>
            )}
            {hasMore && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Type to filter more...
              </div>
            )}
          </div>
        </ScrollArea>
      </SelectContent>
    </Select>
  );
};

export default BranchSelect;
