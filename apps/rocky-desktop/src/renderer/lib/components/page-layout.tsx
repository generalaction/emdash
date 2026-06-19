import { ExternalLink } from 'lucide-react';
import React from 'react';
import { cn } from '@renderer/utils/utils';

export type PageSidebarItem<T extends string = string> = {
  id: T;
  label: string;
  isExternal?: boolean;
};

export function PageSidebarMenu<T extends string>({
  items,
  activeId,
  onSelect,
}: {
  items: ReadonlyArray<PageSidebarItem<T>>;
  activeId: T;
  onSelect: (item: PageSidebarItem<T>) => void;
}) {
  return (
    <div className="sticky top-0 self-start py-10">
      <nav className="flex w-52 flex-col gap-0.5">
        {items.map((item) => {
          const isActive = item.id === activeId && !item.isExternal;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
                isActive &&
                  'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
              )}
            >
              <span className="text-left">{item.label}</span>
              {item.isExternal && <ExternalLink className="h-4 w-4" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function PageContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('mx-auto w-full max-w-4xl px-4', className)}>{children}</div>;
}

export function PageLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="h-full scrollbar-gutter-stable overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-[1060px] px-8">
          <div className="grid w-full grid-cols-[13rem_minmax(0,1fr)] gap-8">
            {sidebar}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
