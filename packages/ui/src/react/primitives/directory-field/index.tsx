import { cx } from '@styles/index';
import { control } from '@styles/recipes/control';
import { fieldControl } from '@styles/recipes/field-control';
import { FolderIcon } from 'lucide-react';
import * as React from 'react';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';
import { Icon } from '../icon';
import * as styles from './directory-field.css';

export type DirectoryFieldSize = FieldControlSize;

export interface DirectoryFieldProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Applies caller-owned classes to the rendered button root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  path?: string;
  placeholder?: string;
  /** Shared text-entry size. @default 'base' */
  size?: DirectoryFieldSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
  /** Text for the trailing action affordance. @default 'Choose' */
  chooseLabel?: string;
}

/**
 * Button-shaped directory picker using the public field-control styling
 * contract. `className` is applied to the rendered button root.
 */
const DirectoryField = React.forwardRef<HTMLButtonElement, DirectoryFieldProps>(
  function DirectoryField(
    {
      className,
      path,
      placeholder = 'Select a directory',
      size = 'base',
      tone = 'neutral',
      chooseLabel = 'Choose',
      type = 'button',
      ...props
    },
    ref
  ) {
    const hasPath = path != null && path.length > 0;

    return (
      <button
        ref={ref}
        type={type}
        data-slot="directory-field"
        data-size={size}
        data-tone={tone}
        className={cx(fieldControl({ size, tone }), styles.layout, className)}
        {...props}
      >
        <Icon source={FolderIcon} className={styles.icon} />
        <span className={cx(styles.value, !hasPath && styles.placeholder)}>
          {hasPath ? path : placeholder}
        </span>
        <span
          className={cx(control({ emphasis: 'medium', size: 'xs' }), styles.chooseAffordance)}
          aria-hidden
        >
          {chooseLabel}
        </span>
      </button>
    );
  }
);

export { DirectoryField };
