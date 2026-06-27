import { detectPlatform } from '@tanstack/react-hotkeys';
import { useRef } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import type { AppMenuId } from '@shared/events/appEvents';

const isMac = detectPlatform() === 'mac';

const MENU_ITEMS: { id: AppMenuId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'help', label: 'Help' },
];

/**
 * Custom in-window application menu bar (File / Edit / View / Help) for Windows
 * and Linux, where the native menu bar is hidden (see window.ts
 * `setMenuBarVisibility(false)`). Each button pops up the matching native
 * submenu anchored beneath it, reusing the single menu definition in
 * `main/app/menu.ts`. Renders nothing on macOS, which keeps the system menu bar.
 */
export function WindowMenuBar({ className }: { className?: string }) {
  if (isMac) return null;
  return (
    <div className={cn('flex items-center [-webkit-app-region:no-drag]', className)}>
      {MENU_ITEMS.map((item) => (
        <MenuBarButton key={item.id} id={item.id} label={item.label} />
      ))}
    </div>
  );
}

function MenuBarButton({ id, label }: { id: AppMenuId; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    void rpc.app.popupAppMenu({
      menu: id,
      x: rect?.left ?? 0,
      y: rect?.bottom ?? 0,
    });
  };

  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="menu"
      // Open on pointer down so the bar feels like a native menu bar.
      onPointerDown={openMenu}
      className="hover:bg-muted flex h-7 items-center rounded-md px-2 text-sm text-foreground-muted transition-colors hover:text-foreground"
    >
      {label}
    </button>
  );
}
