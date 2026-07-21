import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { Icon, type IconName } from '../../primitives/icon';
import * as styles from './page-sidebar-menu.css';

type CSSExtra = { [key: string]: string };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageNavItem {
  /** Distinguishes this item from a divider; may be omitted. */
  kind?: undefined;
  id: string;
  label: string;
  /** Optional kebab-case Lucide icon name. */
  icon?: IconName;
  /** When true an external-link icon is shown and the active state is suppressed. */
  isExternal?: boolean;
}

export interface PageNavDivider {
  kind: 'divider';
  /** Optional label shown above the divider in small, muted text. */
  label?: string;
}

export type PageSidebarMenuItem = PageNavItem | PageNavDivider;

export type PageNavSection = PageNavDivider;

export interface PageSidebarMenuProps {
  items: PageSidebarMenuItem[];
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
        {items.map((item, index) => {
          if (isDivider(item)) {
            return <NavDivider key={`divider-${index}`} label={item.label} />;
          }

          const { id, label, icon, isExternal } = item;
          const isActive = id === activeId && !isExternal;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(item)}
              className={styles.navItem({ active: isActive })}
            >
              {icon && <Icon name={icon} size="sm" className={styles.navItemIcon} />}
              <span className={styles.navItemLabel}>{label}</span>
              {isExternal && (
                <Icon name="external-link" size="xs" className={styles.externalIcon} />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function isDivider(item: PageSidebarMenuItem): item is PageNavDivider {
  return item.kind === 'divider';
}

function NavDivider({ label }: { label?: string }) {
  return (
    <div className={styles.divider} role="separator" aria-label={label}>
      {label && <span className={styles.dividerLabel}>{label}</span>}
    </div>
  );
}

export { PageSidebarMenu };
