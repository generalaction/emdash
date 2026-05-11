import * as React from 'react';
import { cn } from '@renderer/utils/utils';

type DivProps = React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: React.Ref<HTMLButtonElement>;
};

export const SidebarContainer = ({ className, ref, ...props }: DivProps) => (
  <div
    ref={ref}
    className={cn('group/sidebar relative z-50 flex flex-col text-sm text-foreground', className)}
    {...props}
  />
);

export const SidebarHeader = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('flex flex-col gap-1 border-b-0', className)} {...props} />
);

export const SidebarContent = ({ className, ref, ...props }: DivProps) => (
  <div
    ref={ref}
    className={cn('flex flex-1 flex-col overflow-hidden text-sm text-muted-foreground', className)}
    {...props}
  />
);

export const SidebarGroup = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('mb-6 grid', className)} {...props} />
);

export const SidebarGroupContent = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('grid gap-1', className)} {...props} />
);

export const SidebarFooter = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('mt-auto flex flex-col border-t px-3 py-3', className)} {...props} />
);

export const SidebarMenu = ({ className, ref, ...props }: DivProps) => (
  <div ref={ref} className={cn('', className)} {...props} />
);

export const SidebarItemMiniButton = ({ className, ref, ...props }: ButtonProps) => (
  <button
    ref={ref}
    className={cn(
      'size-6 flex items-center justify-center text-foreground-tertiary-muted hover:text-foreground-tertiary rounded-md hover:bg-background-tertiary-2 group-data-[active=true]/row:hover:bg-background-tertiary-3',
      className
    )}
    onMouseDown={(e) => e.preventDefault()}
    onPointerDown={(e) => e.stopPropagation()}
    {...props}
  />
);

const sidebarMenuItemClass =
  'flex w-full font-normal h-8 text-foreground-tertiary-muted rounded-lg items-center hover:bg-background-tertiary-1 hover:text-foreground-tertiary gap-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[active=true]:bg-background-tertiary-2 data-[active=true]:text-foreground-tertiary';

interface SidebarMenuButtonProps extends ButtonProps {
  isActive?: boolean;
}
export const SidebarMenuButton = ({
  className,
  isActive,
  ref,
  ...props
}: SidebarMenuButtonProps) => (
  <button
    ref={ref}
    data-active={isActive || undefined}
    className={cn(sidebarMenuItemClass, className)}
    onMouseDown={(e) => e.preventDefault()}
    {...props}
  />
);

interface SidebarMenuRowProps extends DivProps {
  isActive?: boolean;
}
export const SidebarMenuRow = ({ className, isActive, ref, ...props }: SidebarMenuRowProps) => (
  <div
    ref={ref}
    data-active={isActive || undefined}
    className={cn(sidebarMenuItemClass, className)}
    {...props}
  />
);
