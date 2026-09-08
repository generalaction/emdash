import { cx } from '@styles/index';
import { SearchIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import type { FieldControlSize, FieldControlTone } from '../../../styles/recipes/field-control';
import { Icon } from '../icon';
import { Input } from '../input';
import * as styles from './search-input.css';

export interface SearchInputProps extends Omit<
  React.ComponentProps<'input'>,
  'className' | 'size' | 'style' | 'type'
> {
  /** Applies caller-owned classes to the rendered wrapper root. */
  className?: string;
  /** Applies caller-owned classes to the nested input control slot. */
  inputClassName?: string;
  /** Applies genuine runtime values to the wrapper root. */
  style?: React.CSSProperties;
  /** Applies genuine runtime values to the nested input control slot. */
  inputStyle?: React.CSSProperties;
  /** Shared text-entry size. @default 'base' */
  size?: FieldControlSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
  /** Called when the user clicks the × clear button. Renders the button when provided. */
  onClear?: () => void;
  /** Optional trailing content, such as a keyboard shortcut hint. */
  shortcut?: React.ReactNode;
}

/**
 * SearchInput — a text input with a leading search icon and an optional
 * trailing clear button.
 *
 * Delegates to `Input` for the field-control contract. `className` is applied
 * to the wrapper root; use `inputClassName` for the nested control slot.
 *
 * Usage:
 *   // Uncontrolled, no clear button
 *   <SearchInput placeholder="Search…" />
 *
 *   // Controlled with clear
 *   <SearchInput
 *     value={query}
 *     onChange={(e) => setQuery(e.target.value)}
 *     onClear={() => setQuery('')}
 *     placeholder="Filter tasks…"
 *   />
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    className,
    inputClassName,
    size = 'base',
    tone = 'neutral',
    onClear,
    shortcut,
    value,
    style,
    inputStyle,
    ...props
  },
  ref
) {
  const hasValue = value !== undefined && value !== '';

  return (
    <div data-slot="search-input" className={cx(styles.container, className)} style={style}>
      <Icon source={SearchIcon} className={styles.icon} />

      <Input
        ref={ref}
        type="search"
        size={size}
        tone={tone}
        value={value}
        className={cx(styles.control({ clearable: onClear != null, size }), inputClassName)}
        style={inputStyle}
        {...props}
      />

      {shortcut != null && (
        <span data-slot="search-input-shortcut" className={cx(styles.shortcut)}>
          {shortcut}
        </span>
      )}

      {onClear != null && hasValue && (
        <button
          type="button"
          aria-label="Clear search"
          className={styles.clearButton}
          tabIndex={-1}
          onClick={onClear}
        >
          <Icon source={XIcon} />
        </button>
      )}
    </div>
  );
});

export { SearchInput };
