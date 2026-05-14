import { useHotkey } from '@tanstack/react-hotkeys';
import { Search } from 'lucide-react';
import * as React from 'react';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

type SearchInputProps = React.ComponentProps<'input'> & {
  containerClassName?: string;
};

function SearchInput({ className, containerClassName, ...props }: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  useHotkey(
    'Mod+F',
    () => {
      inputRef.current?.focus();
    },
    { enabled: true }
  );
  return (
    <div className={cn('relative flex min-w-0 items-center', containerClassName)}>
      <Search className="absolute left-2.5 size-3.5 shrink-0 text-foreground-muted pointer-events-none" />
      <Input className={cn('pl-8', className)} {...props} ref={inputRef} />
    </div>
  );
}

export { SearchInput };
