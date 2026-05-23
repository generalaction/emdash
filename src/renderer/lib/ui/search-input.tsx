import { useHotkey } from '@tanstack/react-hotkeys';
import { Search } from 'lucide-react';
import * as React from 'react';
import { useAppShortcutsEnabled } from '@renderer/lib/hooks/use-app-shortcuts-enabled';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

function SearchInput({ className, ...props }: React.ComponentProps<'input'>) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const appShortcutsEnabled = useAppShortcutsEnabled();

  useHotkey(
    'Mod+F',
    () => {
      inputRef.current?.focus();
    },
    { enabled: appShortcutsEnabled }
  );
  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-foreground-muted" />
      <Input className={cn('pl-8', className)} {...props} ref={inputRef} />
    </div>
  );
}

export { SearchInput };
