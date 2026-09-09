import { cx } from '@styles/index';
import { ExternalLink } from 'lucide-react';
import * as React from 'react';
import { Icon, IconSlot, type StaticSvgComponent } from '../../primitives/icon';
import * as styles from './page-sidebar-menu.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageNavItem {
  /** Distinguishes this item from a divider; may be omitted. */
  kind?: undefined;
  id: string;
  label: string;
  /** Optional owned static SVG source or opaque custom icon element. */
  icon?: StaticSvgComponent | React.ReactElement;
  /** When true an external-link icon is shown and the active state is suppressed. */
  isExternal?: boolean;
  /** Keeps the item visible while preventing selection. */
  disabled?: boolean;
  /** Optional compact value displayed at the trailing edge. */
  badge?: string;
}

export interface PageNavDivider {
  kind: 'divider';
  /**
   * @deprecated Use PageNavSection instead. Labeled dividers still render as
   * section labels for compatibility.
   */
  label?: string;
}

export interface PageNavSection {
  kind: 'section';
  id: string;
  label: string;
}

export type PageSidebarMenuItem = PageNavItem | PageNavDivider | PageNavSection;

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
  header?: React.ReactNode;
  footer?: React.ReactNode;
  emptyMessage?: string;
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
 *
 * `className` is applied to the rendered sticky sidebar root. Item selection,
 * focus, disabled state, label overflow, and the caller-owned header/footer
 * slots are styled by this component.
 */
function PageSidebarMenu({
  items,
  activeId,
  onSelect,
  draggable = false,
  className,
  header,
  footer,
  emptyMessage,
}: PageSidebarMenuProps) {
  return (
    <div className={cx(styles.wrapper, draggable && styles.dragRegion, className)}>
      {header && <div className={styles.header}>{header}</div>}
      <nav className={styles.nav}>
        {items.length === 0 && emptyMessage && (
          <div className={styles.emptyMessage}>{emptyMessage}</div>
        )}
        {items.map((item, index) => {
          if (item.kind === 'divider') {
            return <NavDivider key={`divider-${index}`} label={item.label} />;
          }

          if (item.kind === 'section') {
            return <NavSection key={`section-${item.id}`} label={item.label} />;
          }

          const { id, label, icon, isExternal, disabled = false, badge } = item;
          const isActive = id === activeId && !isExternal;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(item)}
              className={styles.navItem({ selected: isActive, disabled })}
            >
              {icon &&
                (React.isValidElement(icon) ? (
                  <IconSlot size="sm" className={styles.navItemIcon}>
                    {icon}
                  </IconSlot>
                ) : (
                  <Icon
                    source={icon as StaticSvgComponent}
                    size="sm"
                    className={styles.navItemIcon}
                  />
                ))}
              <span className={styles.navItemLabel}>{label}</span>
              {badge && <span className={styles.badge}>{badge}</span>}
              {isExternal && (
                <Icon source={ExternalLink} size="xs" className={styles.externalIcon} />
              )}
            </button>
          );
        })}
      </nav>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

function NavDivider({ label }: { label?: string }) {
  if (label) {
    return <NavSection label={label} />;
  }

  return <div className={styles.divider} role="separator" />;
}

function NavSection({ label }: { label: string }) {
  return <div className={styles.sectionLabel}>{label}</div>;
}

export { PageSidebarMenu };
