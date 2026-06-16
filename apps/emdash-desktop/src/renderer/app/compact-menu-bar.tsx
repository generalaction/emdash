import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from 'react';
import { COMPACT_TITLEBAR_HEIGHT } from '@main/app/window-chrome';
import { rpc } from '@renderer/lib/ipc';
import { COMPACT_APP_MENU, type CompactMenuActionId, type CompactMenuItem } from '@shared/app-menu';

const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
const MENU_TOP = COMPACT_TITLEBAR_HEIGHT;

type OpenMenuState = {
  label: string;
  left: number;
};

function menuWidthClass(label: string): string {
  return label === 'View' ? 'min-w-[260px]' : 'min-w-[180px]';
}

export function CompactMenuBar() {
  const [openMenu, setOpenMenu] = useState<OpenMenuState | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const openGroup = openMenu
    ? COMPACT_APP_MENU.find((group) => group.label === openMenu.label)
    : undefined;

  useEffect(() => {
    if (!openMenu) return;

    const handleClickOutside = (event: PointerEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [openMenu]);

  const handleMenuClick = (label: string, event: MouseEvent<HTMLButtonElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    setOpenMenu((prev) => (prev?.label === label ? null : { label, left }));
  };

  const handleActionClick = async (actionId: CompactMenuActionId) => {
    setOpenMenu(null);
    await rpc.app.performCompactMenuAction(actionId);
  };

  return (
    <div ref={menuContainerRef}>
      <div className="bg-muted/30 fixed top-0 right-0 left-0 z-[100] flex h-10 items-center border-b border-border/50 select-none [-webkit-app-region:drag]">
        <div className="flex items-center" style={noDragStyle}>
          {COMPACT_APP_MENU.map((group) => (
            <div key={group.label} className="relative" style={noDragStyle}>
              <button
                type="button"
                className="rounded-sm px-3 py-1 text-xs transition-colors hover:bg-white/10"
                onClick={(event) => handleMenuClick(group.label, event)}
                style={noDragStyle}
              >
                {group.label}
              </button>
            </div>
          ))}
        </div>
        <div className="flex-1 [-webkit-app-region:drag]" />
      </div>
      {openMenu && openGroup && (
        <div
          className={`bg-popover/95 fixed z-[110] ${menuWidthClass(openMenu.label)} rounded-md border border-border shadow-lg backdrop-blur-sm`}
          style={{ ...noDragStyle, top: MENU_TOP, left: openMenu.left }}
        >
          <MenuItems items={openGroup.items} onAction={handleActionClick} />
        </div>
      )}
    </div>
  );
}

interface MenuItemsProps {
  items: readonly CompactMenuItem[];
  onAction: (actionId: CompactMenuActionId) => void;
}

function MenuItems({ items, onAction }: MenuItemsProps) {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  return (
    <div className="py-1" style={noDragStyle}>
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return (
            <div key={`sep-${index}`} className="my-1 h-px bg-border/50" style={noDragStyle} />
          );
        }

        if (item.type === 'submenu') {
          const isOpen = openSubmenu === item.label;
          return (
            <div
              key={item.label}
              className="relative"
              onMouseEnter={() => setOpenSubmenu(item.label)}
              onMouseLeave={() => setOpenSubmenu(null)}
              style={noDragStyle}
            >
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-1.5 text-left text-xs whitespace-nowrap transition-colors hover:bg-white/10"
                style={noDragStyle}
              >
                <span>{item.label}</span>
                <span className="text-[10px]">&gt;</span>
              </button>
              {isOpen && (
                <div
                  className="bg-popover/95 absolute top-0 left-full ml-1 min-w-[180px] rounded-md border border-border shadow-lg backdrop-blur-sm"
                  style={noDragStyle}
                >
                  <MenuItems items={item.items} onAction={onAction} />
                </div>
              )}
            </div>
          );
        }

        // type === 'action'
        return (
          <button
            key={item.id}
            type="button"
            className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-1.5 text-left text-xs whitespace-nowrap transition-colors hover:bg-white/10"
            onClick={() => onAction(item.id)}
            style={noDragStyle}
          >
            <span className="min-w-0 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="text-muted-foreground/70 justify-self-end text-[10px]">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
