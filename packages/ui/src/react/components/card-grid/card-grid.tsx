import { MicroLabel } from '@react/primitives/label';
import { cx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import * as React from 'react';
import * as styles from './card-grid.css';

/**
 * CardGrid — a responsive auto-fit grid of cards. Columns are at least 16rem
 * wide (clamped to the container) and stretch to fill the row. `className`
 * is applied to the rendered grid root; children are caller-owned.
 */
function CardGrid({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="card-grid" className={cx(styles.grid, className)} {...props}>
      {children}
    </div>
  );
}

export interface CardGridSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Section heading rendered as a MicroLabel above the grid. */
  title: string;
}

/** CardGridSection — a MicroLabel heading followed by a CardGrid of children. */
function CardGridSection({ title, className, children, ...props }: CardGridSectionProps) {
  return (
    <div data-slot="card-grid-section" className={cx(styles.section, className)} {...props}>
      <MicroLabel>{title}</MicroLabel>
      <CardGrid>{children}</CardGrid>
    </div>
  );
}

export interface CardGridItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Enables button semantics, focus, and keyboard activation. */
  interactive?: boolean;
  /** Applies the selected card state. */
  selected?: boolean;
  /** Keeps an interactive card visible while preventing activation. */
  disabled?: boolean;
}

/**
 * CardGridItem — a card row for use inside CardGrid.
 *
 * This component owns its card surface, layout, selection, focus, and disabled
 * states. Callers own the inner content and hover-reveal affordances.
 * `className` is applied to the rendered card root.
 */
function CardGridItem({
  interactive = false,
  selected = false,
  disabled = false,
  className,
  children,
  role,
  tabIndex,
  onClick,
  onKeyDown,
  ...props
}: CardGridItemProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      return;
    }
    onKeyDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.currentTarget.click();
  };

  return (
    <div
      data-slot="card-grid-item"
      {...props}
      role={interactive ? (role ?? 'button') : role}
      tabIndex={interactive ? (disabled ? -1 : (tabIndex ?? 0)) : tabIndex}
      aria-pressed={interactive ? selected : undefined}
      aria-disabled={disabled || undefined}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      className={cx(
        surface({ level: 'base' }),
        styles.item({ interactive, selected, disabled }),
        className
      )}
      onClick={
        disabled
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
            }
          : onClick
      }
      onKeyDown={interactive ? handleKeyDown : onKeyDown}
    >
      {children}
    </div>
  );
}

export { CardGrid, CardGridSection, CardGridItem };
