import { cx } from '@styles/index';
import * as React from 'react';
import * as styles from './list-view.css';

// ── Root ──────────────────────────────────────────────────────────────────────

/** `className` is applied to the rendered list-view root. */
function ListViewRoot({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="list-view" className={cx(styles.root, className)} {...props} />;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

/**
 * ListView.Toolbar — sticky header above the list.
 * Place ToggleGroups, SearchInputs, sort Selects, and filter buttons here.
 * Multiple children are stacked as flex-column rows.
 * `className` is applied to the rendered toolbar root.
 */
function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="list-view-toolbar" className={cx(styles.toolbar, className)} {...props} />;
}

// ── FilterPills ───────────────────────────────────────────────────────────────

/**
 * ListView.FilterPills — horizontal pill strip for active filters.
 * Renders null when there are no visible children so the toolbar row
 * collapses cleanly when no filters are active.
 * `className` is applied to the rendered filter-strip root.
 */
function FilterPills({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const hasChildren = React.Children.count(children) > 0;
  if (!hasChildren) return null;
  return (
    <div
      data-slot="list-view-filter-pills"
      className={cx(styles.filterPills, className)}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Body ──────────────────────────────────────────────────────────────────────

/**
 * ListView.Body — the flex-1 scroll region.
 * Place a single `ListView.List` inside here.
 * `className` is applied to the rendered body root.
 */
function Body({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="list-view-body" className={cx(styles.body, className)} {...props} />;
}

// ── Footer ────────────────────────────────────────────────────────────────────

/**
 * ListView.Footer — absolute overlay pinned to the bottom of the root.
 * Use for floating selection bars or pagination indicators that appear
 * on top of the list without displacing it.
 * `className` is applied to the positioned footer root; children remain
 * caller-owned and interactive inside the pointer-transparent overlay.
 */
function Footer({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="list-view-footer" className={cx(styles.footer, className)} {...props}>
      <div className={styles.footerContent}>{children}</div>
    </div>
  );
}

export { ListViewRoot, Toolbar, FilterPills, Body, Footer };
