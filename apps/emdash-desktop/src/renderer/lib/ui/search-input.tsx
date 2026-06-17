import { Search } from 'lucide-react';
import * as React from 'react';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

type SearchInputProps = React.ComponentProps<'input'> & {
  containerClassName?: string;
};

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { className, containerClassName, ...props },
  forwardedRef
) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  return (
    <div className={cn('relative flex min-w-0 items-center', containerClassName)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 shrink-0 text-foreground-muted" />
      <Input className={cn('pl-8', className)} {...props} ref={inputRef} />
    </div>
  );
});

export { SearchInput };
