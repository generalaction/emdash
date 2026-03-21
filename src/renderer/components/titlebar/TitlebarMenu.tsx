import React, { useCallback, useRef, useState } from 'react';

const MENU_LABELS = ['File', 'Edit', 'View', 'Window', 'Help'] as const;

const TitlebarMenu: React.FC = () => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((label: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    window.electronAPI.popupMenu({
      label,
      x: rect.left,
      y: rect.bottom,
    });
    setActiveMenu(null);
  }, []);

  const handleMouseEnter = useCallback(
    (label: string, e: React.MouseEvent<HTMLButtonElement>) => {
      if (activeMenu && activeMenu !== label) {
        const rect = e.currentTarget.getBoundingClientRect();
        window.electronAPI.popupMenu({
          label,
          x: rect.left,
          y: rect.bottom,
        });
        setActiveMenu(label);
      }
    },
    [activeMenu]
  );

  return (
    <div ref={barRef} className="flex items-center [-webkit-app-region:no-drag]">
      {MENU_LABELS.map((label) => (
        <button
          key={label}
          type="button"
          className="h-[var(--tb,36px)] px-2.5 text-xs text-foreground/80 transition-colors hover:bg-foreground/10"
          onClick={(e) => {
            setActiveMenu(label);
            handleClick(label, e);
          }}
          onMouseEnter={(e) => handleMouseEnter(label, e)}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

export default TitlebarMenu;
