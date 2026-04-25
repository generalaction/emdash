import { ChevronsUpDownIcon } from 'lucide-react';
import { type ReactNode } from 'react';

export function ComboxInputTrigger({
  children,
  ref,
}: {
  children: ReactNode;
  ref?: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none"
    >
      {children}
      <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
