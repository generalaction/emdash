import { Search } from 'lucide-react';
import * as React from 'react';
import { isTextInputFocusTarget, useChordKeydown } from '@core/primitives/keybindings/browser';
import { cn } from '@core/primitives/ui/browser/cn';
import { Input } from '@core/primitives/ui/browser/input';
import { Shortcut } from '@core/primitives/ui/browser/shortcut';

type SearchInputProps = React.ComponentProps<'input'> & {
  containerClassName?: string;
  shortcutHotkey?: string;
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

  useChordKeydown(
    'Mod+F',
    (event) => {
      event.preventDefault();
      focusInput();
    },
    { enabled: focusHotkey }
  );

  useChordKeydown(
    '/',
    (event) => {
      if (isTextInputFocusTarget(event.target)) return;
      event.preventDefault();
      focusInput();
    },
    { enabled: focusSlashHotkey }
  );

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
