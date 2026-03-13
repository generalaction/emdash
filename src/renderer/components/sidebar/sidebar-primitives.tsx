import * as React from 'react';
import { cn } from '@renderer/lib/utils';

export const SidebarContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'group/sidebar relative z-50 flex h-full flex-col bg-accent text-sm text-foreground dark:bg-muted/10',
      className
    )}
    {...props}
  />
));
SidebarContainer.displayName = 'SidebarContainer';

export const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 border-b-0 px-3 py-3', className)}
      {...props}
    />
  )
);
SidebarHeader.displayName = 'SidebarHeader';

export const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex flex-1 flex-col overflow-y-auto px-3 py-4 text-sm text-muted-foreground',
      className
    )}
    {...props}
  />
));
SidebarContent.displayName = 'SidebarContent';

export const SidebarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mb-6 grid gap-1', className)} {...props} />
  )
);
SidebarGroup.displayName = 'SidebarGroup';

export const SidebarGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'text-xs font-semibold uppercase tracking-wide text-muted-foreground/70',
      className
    )}
    {...props}
  />
));
SidebarGroupLabel.displayName = 'SidebarGroupLabel';

export const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('grid gap-1', className)} {...props} />
));
SidebarGroupContent.displayName = 'SidebarGroupContent';

export const SidebarMenu = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('grid gap-1', className)} {...props} />
  )
);
SidebarMenu.displayName = 'SidebarMenu';

export const SidebarMenuItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { isActive?: boolean }
>(({ className, isActive, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex w-full rounded-lg items-center hover:bg-accent-hover text-muted-foreground gap-2 px-3 py-2 text-sm transition-colors hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[active=true]:bg-accent-layer data-[active=true]:text-accent-foreground',
      className
    )}
    data-active={isActive ? 'true' : undefined}
    {...props}
  />
));
SidebarMenuItem.displayName = 'SidebarMenuItem';

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ className, isActive, ...props }, ref) => (
    <button
      ref={ref}
      data-active={isActive ? 'true' : undefined}
      className={cn(
        'flex w-full rounded-lg items-center hover:bg-accent-hover text-muted-foreground gap-2 px-3 py-2 text-sm transition-colors hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[active=true]:bg-accent-layer data-[active=true]:text-accent-foreground',
        className
      )}
      {...props}
    />
  )
);
SidebarMenuButton.displayName = 'SidebarMenuButton';
