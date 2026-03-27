import * as React from 'react';
import { cn } from '@renderer/lib/utils';

export const SidebarContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('group/sidebar relative z-50 flex flex-col text-sm text-foreground', className)}
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
      'flex flex-1 flex-col overflow-hidden px-3 py-4 text-sm text-muted-foreground',
      className
    )}
    {...props}
  />
));
SidebarContent.displayName = 'SidebarContent';

export const SidebarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mb-6 grid gap-3', className)} {...props} />
  )
);
SidebarGroup.displayName = 'SidebarGroup';

export const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('grid gap-1', className)} {...props} />
));
SidebarGroupContent.displayName = 'SidebarGroupContent';

export const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('mt-auto flex flex-col border-t px-3 py-3', className)}
      {...props}
    />
  )
);
SidebarFooter.displayName = 'SidebarFooter';

export const SidebarMenu = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('grid gap-0.5', className)} {...props} />
  )
);
SidebarMenu.displayName = 'SidebarMenu';

export const SidebarItemMiniButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'w-6 h-6 flex items-center justify-center text-foreground-tertiary-muted hover:text-foreground-tertiary rounded-md hover:bg-background-tertiary-2 group-data-[active=true]/row:hover:bg-background-tertiary-3',
      className
    )}
    {...props}
  />
));
SidebarItemMiniButton.displayName = 'SidebarItemMiniButton';

const sidebarMenuItemClass =
  'flex w-full font-normal text-foreground-tertiary-muted rounded-lg items-center hover:bg-background-tertiary-1 hover:text-foreground-tertiary gap-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[active=true]:bg-background-tertiary-2 data-[active=true]:text-foreground-tertiary';

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
}
export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ className, isActive, ...props }, ref) => (
    <button
      ref={ref}
      data-active={isActive || undefined}
      className={cn(sidebarMenuItemClass, className)}
      {...props}
    />
  )
);

interface SidebarMenuRowProps extends React.HTMLAttributes<HTMLDivElement> {
  isActive?: boolean;
}
export const SidebarMenuRow = React.forwardRef<HTMLDivElement, SidebarMenuRowProps>(
  ({ className, isActive, ...props }, ref) => (
    <div
      ref={ref}
      data-active={isActive || undefined}
      className={cn(sidebarMenuItemClass, className)}
      {...props}
    />
  )
);
