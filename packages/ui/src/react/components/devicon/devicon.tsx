import { cx } from '@styles/index';
import * as React from 'react';
import * as styles from './devicon.css';

export interface DeviconProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'aria-hidden' | 'aria-label' | 'children' | 'role'
> {
  /** Devicon's foreign font-class contract, including optional modifiers. */
  iconClass: string;
  /** Runtime glyph box size. Numbers are treated as CSS pixel values. */
  size?: string | number;
  /** Exposes the glyph as an image. Omit when adjacent text supplies its meaning. */
  label?: string;
}

/**
 * Contains a Devicon font glyph beneath an owned sizing and accessibility root.
 *
 * The foreign class string remains confined to the child `<i>` and Devicon's
 * vendor stylesheet. The private size property is an adapter detail, not a Token.
 */
export function Devicon({
  iconClass,
  size = '1rem',
  label,
  className,
  style,
  ...props
}: DeviconProps) {
  return (
    <span
      {...props}
      className={cx(styles.deviconAdapter, className)}
      style={
        {
          '--_devicon-size': typeof size === 'number' ? `${size}px` : size,
          ...style,
        } as React.CSSProperties
      }
      data-foreign-adapter="devicon"
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
    >
      <i className={iconClass} />
    </span>
  );
}
