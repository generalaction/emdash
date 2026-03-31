import { useHotkey } from '@tanstack/react-hotkeys';
import { Search } from 'lucide-react';
import * as React from 'react';
import { Input } from '@renderer/components/ui/input';
import { cn } from '@renderer/lib/utils';

function SearchInput({ className, ...props }: React.ComponentProps<'input'>) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  useHotkey(
    'Mod+F',
    () => {
      inputRef.current?.focus();
    },
    { enabled: true }
  );
  return (
    <div className="relative flex items-center">
      <Search className="absolute left-2.5 size-3.5 shrink-0 text-foreground-muted pointer-events-none" />
      <Input className={cn('pl-8', className)} {...props} ref={inputRef} />
    </div>
  );
}

export { SearchInput };
