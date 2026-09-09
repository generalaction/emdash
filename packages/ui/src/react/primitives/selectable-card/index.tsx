/**
 * SelectableCard — a flat, bordered button card with hover and selected states.
 *
 * Renders as a `<button>` by default. Uses a fixed elevated surface background
 * and a neutral border that becomes more prominent when selected. Text color
 * shifts from muted (unselected) to foreground (selected); non-interactive cards
 * use passive text.
 */

import { cx } from '@styles/index';
import * as React from 'react';
import { selectableCard } from './selectable-card.css';

export type SelectableCardJustify = 'flex-start' | 'center' | 'flex-end';
export type SelectableCardPadding = '2' | '3';
export type SelectableCardRadius = 'md' | 'lg';

export interface SelectableCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Horizontal alignment of the card content. */
  justifyContent?: SelectableCardJustify;
  /** Selected / active state. */
  selected?: boolean;
  /** Enables hover + selected styling. */
  interactive?: boolean;
  /** Padding scale token. */
  padding?: SelectableCardPadding;
  /** Border radius scale token. */
  borderRadius?: SelectableCardRadius;
}

export const SelectableCard = React.forwardRef<HTMLButtonElement, SelectableCardProps>(
  function SelectableCard(
    {
      justifyContent,
      selected = false,
      interactive = true,
      padding,
      borderRadius,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        data-selected={selected ? 'true' : undefined}
        aria-selected={selected}
        data-interactive={interactive ? 'true' : 'false'}
        className={cx(selectableCard({ justifyContent, padding, borderRadius }), className)}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
