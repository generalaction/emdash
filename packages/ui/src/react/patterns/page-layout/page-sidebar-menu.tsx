import { cx } from '@styles/utilities/cx';
import { ExternalLinkIcon } from 'lucide-react';
import * as React from 'react';
import * as styles from './page-sidebar-menu.css';

type CSSExtra = { [key: string]: string };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageNavItem {
  id: string;
  label: string;
  /** Optional leading icon node. */
  icon?: React.ReactNode;
  /** When true an external-link icon is shown and the active state is suppressed. */
  isExternal?: boolean;
}

export interface PageSidebarMenuProps {
  items: PageNavItem[];
  activeId: string;
  onSelect: (item: PageNavItem) => void;
  /**
   * Adds an Electron window drag region to the sticky wrapper.
   * The nav buttons themselves are always excluded from the drag region.
   * Default: false.
   */
  draggable?: boolean;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * PageLayout.SidebarMenu — a self-contained sticky nav with clickable items.
 *
 * Generalizes the `PageSidebarMenu` used in the Library and Settings views:
 * sticky wrapper, w-52 nav column, idle/hover/active button states.
 *
 * Usage:
 * ```tsx
 * <PageLayout sidebar={
 *   <PageLayout.SidebarMenu
 *     items={[{ id: 'prompts', label: 'Prompts' }, { id: 'skills', label: 'Skills' }]}
 *     activeId={tab}
 *     onSelect={(item) => setTab(item.id)}
 *   />
 * }>
 *   …
 * </PageLayout>
 * ```
 */
function PageSidebarMenu({
  items,
  activeId,
  onSelect,
  draggable = false,
  className,
}: PageSidebarMenuProps) {
  // Inline style type-cast for Electron drag region so vanilla-extract is not
  // involved (no CSS file needed for this runtime-conditional style).
  const wrapperStyle: React.CSSProperties & CSSExtra = draggable ? { WebkitAppRegion: 'drag' } : {};

  return (
    <div className={cx(styles.wrapper, className)} style={wrapperStyle}>
      <nav className={styles.nav}>
        {items.map((item) => {
          const isActive = item.id === activeId && !item.isExternal;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={styles.navItem({ active: isActive })}
            >
              {item.icon && (
                <span className={styles.navItemIcon} aria-hidden>
                  {item.icon}
                </span>
              )}
              <span className={styles.navItemLabel}>{item.label}</span>
              {item.isExternal && <ExternalLinkIcon className={styles.externalIcon} aria-hidden />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export { PageSidebarMenu };
