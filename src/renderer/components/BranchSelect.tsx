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
const EMPTY_BRANCH_VALUE = '__branch_select_empty__';

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

  const navigationKeys = useMemo(
    () => new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Escape']),
    []
  );

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options;
    const query = searchTerm.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [options, searchTerm]);

  const displayedOptions = useMemo(() => {
    if (!value) return filteredOptions;
    const hasSelection = filteredOptions.some((option) => option.value === value);
    if (hasSelection) return filteredOptions;
    const selectedOption = options.find((option) => option.value === value);
    if (!selectedOption) return filteredOptions;
    return [selectedOption, ...filteredOptions];
  }, [filteredOptions, options, value]);

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
  const hasKnownSelection = Boolean(value && options.some((option) => option.value === value));
  const selectedValue = hasKnownSelection ? (value as string) : EMPTY_BRANCH_VALUE;

  const triggerClassName =
    variant === 'ghost'
      ? 'h-auto border-none bg-transparent p-0 text-xs text-muted-foreground shadow-none hover:text-foreground focus:ring-0 [&>svg]:ml-0.5 [&>svg]:h-3 [&>svg]:w-3'
      : 'h-8 w-full gap-2 px-3 text-xs font-medium shadow-none sm:w-auto';

  return (
    <Select
      value={selectedValue}
      onValueChange={onValueChange}
      disabled={disabled || isLoading || options.length === 0}
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
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">No matching branches</div>
            )}
          </div>
        </ScrollArea>
      </SelectContent>
    </Select>
  );
};

export default BranchSelect;
