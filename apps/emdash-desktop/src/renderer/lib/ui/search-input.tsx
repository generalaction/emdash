import { useHotkey } from '@tanstack/react-hotkeys';
import { Search, X } from 'lucide-react';
import * as React from 'react';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

type SearchInputProps = React.ComponentProps<'input'> & {
  containerClassName?: string;
  clearLabel?: string;
  onClear?: () => void;
  selectOnHotkey?: boolean;
};

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    className,
    clearLabel = 'Clear search',
    containerClassName,
    onClear,
    selectOnHotkey = false,
    value,
    ...props
  },
  forwardedRef
) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const showClearButton = Boolean(value) && onClear;

  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  useHotkey(
    'Mod+F',
    () => {
      inputRef.current?.focus();
      if (selectOnHotkey) {
        inputRef.current?.select();
      }
    },
    { enabled: true }
  );
  return (
    <div className={cn('relative flex min-w-0 items-center', containerClassName)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-foreground-muted" />
      <Input
        className={cn('pl-8', showClearButton && 'pr-8', className)}
        {...props}
        value={value}
        ref={inputRef}
      />
      {showClearButton && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-foreground-passive transition-colors hover:bg-background-1 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
});

export { SearchInput };
