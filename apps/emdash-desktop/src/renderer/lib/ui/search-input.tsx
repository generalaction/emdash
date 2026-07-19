import { useHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import { Search } from 'lucide-react';
import * as React from 'react';
import { Input } from '@renderer/lib/ui/input';
import { Shortcut } from '@renderer/lib/ui/shortcut';
import { cn } from '@renderer/utils/utils';

type SearchInputProps = React.ComponentProps<'input'> & {
  containerClassName?: string;
  shortcutHotkey?: Hotkey;
  /** Focus this input on Mod+F. Disable when another SearchInput on the page owns the hotkey. */
  focusHotkey?: boolean;
  /** Focus this input when `/` is pressed outside an editable control. */
  focusSlashHotkey?: boolean;
};

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    className,
    containerClassName,
    shortcutHotkey,
    focusHotkey = true,
    focusSlashHotkey = false,
    ...props
  },
  forwardedRef
) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const focusInput = React.useCallback(() => inputRef.current?.focus(), []);

  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  useHotkey('Mod+F', focusInput, { enabled: focusHotkey });
  useHotkey('/', focusInput, { enabled: focusSlashHotkey, ignoreInputs: true });

  return (
    <div className={cn('relative flex min-w-0 items-center', containerClassName)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-foreground-muted" />
      <Input
        className={cn('pl-8', shortcutHotkey && 'pr-16', className)}
        {...props}
        ref={inputRef}
      />
      {shortcutHotkey && (
        <Shortcut
          hotkey={shortcutHotkey}
          variant="keycaps"
          className="pointer-events-none absolute right-2"
        />
      )}
    </div>
  );
});

export { SearchInput };
