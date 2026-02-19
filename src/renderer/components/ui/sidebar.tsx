import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

interface SidebarContextValue {
  open: boolean;
  isMobile: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | undefined>(undefined);

function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    setMatches(mediaQuery.matches);

    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

type SidebarVariant = 'default' | 'unstyled';

interface SidebarProviderProps {
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function SidebarProvider({ defaultOpen = true, children }: SidebarProviderProps) {
  const isMobile = useMediaQuery('(max-width: 1024px)');
  const storageKey = 'emdash.sidebarOpen';

  const [desktopOpen, setDesktopOpen] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return defaultOpen;
      return stored === 'true';
    } catch {
      return defaultOpen;
    }
  });
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    if (isMobile) {
      setMobileOpen(false);
    }
  }, [isMobile]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, desktopOpen ? 'true' : 'false');
    } catch {
      // ignore persistence errors
    }
  }, [desktopOpen, storageKey]);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isMobile) {
        setMobileOpen(next);
        return;
      }
      setDesktopOpen(next);
    },
    [isMobile]
  );

  const toggle = React.useCallback(() => {
    if (isMobile) {
      setMobileOpen((prev) => !prev);
      return;
    }
    setDesktopOpen((prev) => !prev);
  }, [isMobile]);

  const open = isMobile ? mobileOpen : desktopOpen;

  const value = React.useMemo(
    () => ({
      open,
      isMobile,
      setOpen,
      toggle,
    }),
    [open, isMobile, setOpen, toggle]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SidebarVariant;
}

const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, children, variant = 'default', ...props }, ref) => {
    const { open, isMobile, setOpen } = useSidebar();

    const baseClasses =
      variant === 'default'
        ? 'group/sidebar relative z-50 flex h-full flex-col border-r border-border bg-muted/10 text-sm text-foreground transition-all duration-200 ease-linear overflow-hidden flex-shrink-0 data-[state=collapsed]:border-r-0 data-[state=collapsed]:pointer-events-none'
        : '';
    const responsiveClasses =
      variant === 'default'
        ? isMobile
          ? cn(
              'fixed inset-y-0 left-0 w-[var(--sidebar-width-mobile,18rem)] bg-background shadow-lg',
              open ? 'translate-x-0' : '-translate-x-full'
            )
          : cn(open ? 'w-full' : 'w-0')
        : '';

    return (
      <>
        <aside
          ref={ref}
          data-state={open ? 'open' : 'collapsed'}
          data-mobile={isMobile ? 'true' : 'false'}
          className={cn(baseClasses, responsiveClasses, className)}
          {...props}
        >
          {children}
        </aside>
        {isMobile && open ? (
          <button
            type="button"
            aria-label="Close sidebar overlay"
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
            onClick={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }
);
Sidebar.displayName = 'Sidebar';

const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 border-b border-border px-4 py-3', className)}
      {...props}
    />
  )
);
SidebarHeader.displayName = 'SidebarHeader';

interface SidebarContentProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SidebarVariant;
}

const SidebarContent = React.forwardRef<HTMLDivElement, SidebarContentProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex-1 overflow-y-auto',
        variant === 'default' ? 'px-3 py-4 text-sm text-muted-foreground' : '',
        className
      )}
      {...props}
    />
  )
);
SidebarContent.displayName = 'SidebarContent';

const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('mt-auto border-t border-border px-4 py-3', className)}
      {...props}
    />
  )
);
SidebarFooter.displayName = 'SidebarFooter';

const SidebarInset = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-1 flex-col', className)} {...props} />
  )
);
SidebarInset.displayName = 'SidebarInset';

const SidebarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mb-6 grid gap-1', className)} {...props} />
  )
);
SidebarGroup.displayName = 'SidebarGroup';

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70',
        className
      )}
      {...props}
    />
  )
);
SidebarGroupLabel.displayName = 'SidebarGroupLabel';

const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('grid gap-1', className)} {...props} />
  )
);
SidebarGroupContent.displayName = 'SidebarGroupContent';

const SidebarMenu = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('grid gap-1', className)} {...props} />
  )
);
SidebarMenu.displayName = 'SidebarMenu';

interface SidebarMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {}

const SidebarMenuItem = React.forwardRef<HTMLDivElement, SidebarMenuItemProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('list-none', className)} {...props} />
  )
);
SidebarMenuItem.displayName = 'SidebarMenuItem';

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  isActive?: boolean;
}

const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ className, asChild = false, isActive, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref as any}
        data-active={isActive ? 'true' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground',
          className
        )}
        {...props}
      />
    );
  }
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

const SidebarMenuIcon = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex h-5 w-5 items-center justify-center text-muted-foreground', className)}
      {...props}
    />
  )
);
SidebarMenuIcon.displayName = 'SidebarMenuIcon';

const SidebarMenuBadge = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'ml-auto inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className
      )}
      {...props}
    />
  )
);
SidebarMenuBadge.displayName = 'SidebarMenuBadge';

const SidebarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => {
  const { toggle } = useSidebar();
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => toggle()}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden',
        className
      )}
      {...props}
    />
  );
});
SidebarTrigger.displayName = 'SidebarTrigger';

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuIcon,
  SidebarMenuItem,
  SidebarTrigger,
};
