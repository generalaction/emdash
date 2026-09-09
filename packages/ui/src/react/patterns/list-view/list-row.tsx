import { cx } from '@styles/index';
import * as React from 'react';
import * as styles from './list-row.css';

// ── Row ───────────────────────────────────────────────────────────────────────

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether this row has hover/click affordance. */
  interactive?: boolean;
  /** Whether this row is in a selected state. */
  selected?: boolean;
  /** Whether interaction is unavailable while the row remains visible. */
  disabled?: boolean;
  /** Suppresses the bottom border on the final row of a list. */
  isLast?: boolean;
  /** Divider color: 'default' (border) or 'subtle' (borderSubtle). */
  divider?: 'default' | 'subtle';
  /** When true the inner padding wrapper is omitted so you control layout. */
  bare?: boolean;
}

/**
 * ListView.Row — a bordered, optionally interactive list row.
 *
 * Generalizes the `MultiLineListItem` pattern used throughout the desktop app:
 * border-bottom divider, hover/focus state, selected/disabled state, and
 * optional bare mode for custom inner layout. `className` is applied to the
 * rendered row root.
 *
 * Usage:
 *   <ListView.Row interactive onClick={...}>
 *     <MyRowContent />
 *   </ListView.Row>
 */
function Row({
  interactive = false,
  selected = false,
  disabled = false,
  isLast = false,
  divider = 'default',
  bare = false,
  className,
  children,
  onClick,
  onKeyDown,
  role,
  tabIndex,
  ...props
}: RowProps) {
  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> | undefined =
    interactive || disabled || onKeyDown
      ? (event) => {
          if (disabled) {
            if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
            return;
          }

          onKeyDown?.(event);
          if (
            event.defaultPrevented ||
            !interactive ||
            event.target !== event.currentTarget ||
            (event.key !== 'Enter' && event.key !== ' ')
          ) {
            return;
          }
          event.preventDefault();
          event.currentTarget.click();
        }
      : undefined;

  return (
    <div
      {...props}
      data-slot="list-row"
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      role={interactive ? (role ?? 'button') : role}
      tabIndex={interactive ? (disabled ? -1 : (tabIndex ?? 0)) : tabIndex}
      className={cx(styles.row({ interactive, selected, disabled, isLast, divider }), className)}
      onClick={
        disabled
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
            }
          : onClick
      }
      onKeyDown={handleKeyDown}
    >
      {bare ? children : <div className={styles.rowInner}>{children}</div>}
    </div>
  );
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Section label text. */
  label: React.ReactNode;
  /** Optional count shown in muted text after the label. */
  count?: number;
}

/**
 * ListView.SectionHeader — a styled section label with an optional item count.
 *
 * Mirrors the `SectionLabel` pattern from `CliAgentsList.tsx`:
 *   <SectionHeader label="Recommended" count={4} />
 *   → "Recommended (4)"
 *
 * `className` and remaining div attributes are applied to the rendered
 * section-header root.
 */
function SectionHeader({ label, count, className, ...props }: SectionHeaderProps) {
  return (
    <div data-slot="list-section-header" className={cx(styles.sectionHeader, className)} {...props}>
      <span className={styles.sectionHeaderLabel}>{label}</span>
      {count !== undefined && <span className={styles.sectionHeaderCount}>({count})</span>}
    </div>
  );
}

export { Row, SectionHeader };
