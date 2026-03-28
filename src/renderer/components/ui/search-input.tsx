import { Search } from 'lucide-react';
import * as React from 'react';
import { Input } from '@renderer/components/ui/input';
import { cn } from '@renderer/lib/utils';

function SearchInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <div className="relative flex items-center">
      <Search className="absolute left-2.5 size-3.5 shrink-0 text-foreground-muted pointer-events-none" />
      <Input className={cn('pl-8', className)} {...props} />
    </div>
  );
}

export { SearchInput };
