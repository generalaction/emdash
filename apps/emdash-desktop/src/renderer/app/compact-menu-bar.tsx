import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { COMPACT_APP_MENU, type CompactMenuActionId, type CompactMenuItem } from '@shared/app-menu';

export function CompactMenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const handleMenuClick = (label: string) => {
    setOpenMenu((prev) => (prev === label ? null : label));
  };

  const handleActionClick = async (actionId: CompactMenuActionId) => {
    setOpenMenu(null);
    await rpc.app.performCompactMenuAction(actionId);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Only close if focus is moving outside the menu bar
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setOpenMenu(null);
    }
  };

  return (
    <div
      className="bg-muted/30 fixed top-0 right-0 left-0 z-[100] flex h-10 items-center border-b border-border/50 select-none [-webkit-app-region:drag]"
      onBlur={handleBlur}
    >
      <div className="flex items-center [-webkit-app-region:no-drag]">
        {COMPACT_APP_MENU.map((group) => (
          <div key={group.label} className="relative">
            <button
              type="button"
              className="rounded-sm px-3 py-1 text-xs transition-colors hover:bg-white/10 [-webkit-app-region:no-drag]"
              onClick={() => handleMenuClick(group.label)}
            >
              {group.label}
            </button>
            {openMenu === group.label && (
              <div className="bg-popover/95 absolute top-full left-0 z-[110] mt-0.5 min-w-[180px] rounded-md border border-border shadow-lg backdrop-blur-sm [-webkit-app-region:no-drag]">
                <MenuItems items={group.items} onAction={handleActionClick} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex-1 [-webkit-app-region:drag]" />
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
    <div className="py-1 [-webkit-app-region:no-drag]">
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} className="my-1 h-px bg-border/50" />;
        }

        if (item.type === 'submenu') {
          const isOpen = openSubmenu === item.label;
          return (
            <div
              key={item.label}
              className="relative"
              onMouseEnter={() => setOpenSubmenu(item.label)}
              onMouseLeave={() => setOpenSubmenu(null)}
            >
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-xs whitespace-nowrap transition-colors hover:bg-white/10 [-webkit-app-region:no-drag]"
              >
                <span>{item.label}</span>
                <span className="text-[10px]">▸</span>
              </button>
              {isOpen && (
                <div className="bg-popover/95 absolute top-0 left-full ml-1 min-w-[180px] rounded-md border border-border shadow-lg backdrop-blur-sm [-webkit-app-region:no-drag]">
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
            className="flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-1.5 text-left text-xs whitespace-nowrap transition-colors hover:bg-white/10 [-webkit-app-region:no-drag]"
            onClick={() => onAction(item.id)}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-muted-foreground/70 flex-shrink-0 text-[10px]">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
