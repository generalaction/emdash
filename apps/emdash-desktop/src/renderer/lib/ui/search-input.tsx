import { useHotkey } from '@tanstack/react-hotkeys';
import { Search } from 'lucide-react';
import * as React from 'react';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

type SearchInputProps = React.ComponentProps<'input'> & {
  containerClassName?: string;
  /** Focus this input on Mod+F. Disable when another SearchInput on the page owns the hotkey. */
  focusHotkey?: boolean;
};

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { className, containerClassName, focusHotkey = true, ...props },
  forwardedRef
) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  useHotkey(
    'Mod+F',
    () => {
      inputRef.current?.focus();
    },
    { enabled: focusHotkey }
  );
  return (
    <div className={cn('relative flex min-w-0 items-center', containerClassName)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-foreground-muted" />
      <Input className={cn('pl-8', className)} {...props} ref={inputRef} />
    </div>
  );
});

export { SearchInput };
