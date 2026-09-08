import { cx } from '@styles/index';
import * as React from 'react';
import { SearchInput } from '../../primitives/search-input';
import * as styles from './collection-toolbar.css';

export interface CollectionToolbarProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children'
> {
  /** Current search query. */
  searchValue: string;
  /** Called with the next query whenever the search field changes or is cleared. */
  onSearchValueChange: (value: string) => void;
  /** Placeholder displayed in the search field. */
  searchPlaceholder: string;
  /** Accessible label for the search field. Defaults to `searchPlaceholder`. */
  searchLabel?: string;
  /** Keeps the search field visible while making it unavailable. */
  searchDisabled?: boolean;
  /** Optional collection metadata or status displayed after the search field. */
  metadata?: React.ReactNode;
  /** Optional collection actions displayed at the trailing edge. */
  actions?: React.ReactNode;
}

/**
 * CollectionToolbar — a consistent search, metadata, and actions row for any
 * collection renderer. It deliberately does not depend on CollectionView,
 * ListView, or a particular list/grid implementation.
 *
 * `metadata` and `actions` are caller-owned content slots. `className` and
 * remaining HTML attributes are applied to the rendered toolbar root; the
 * component owns responsive alignment, overflow, and search availability.
 */
export const CollectionToolbar = React.forwardRef<HTMLInputElement, CollectionToolbarProps>(
  function CollectionToolbar(
    {
      searchValue,
      onSearchValueChange,
      searchPlaceholder,
      searchLabel = searchPlaceholder,
      searchDisabled = false,
      metadata,
      actions,
      className,
      ...props
    },
    ref
  ) {
    const hasTrailingContent = metadata != null || actions != null;

    return (
      <div data-slot="collection-toolbar" className={cx(styles.root, className)} {...props}>
        <div data-slot="collection-toolbar-search" className={styles.search}>
          <SearchInput
            ref={ref}
            size="base"
            value={searchValue}
            disabled={searchDisabled}
            onChange={(event) => onSearchValueChange(event.target.value)}
            onClear={() => onSearchValueChange('')}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
          />
        </div>
        {hasTrailingContent && (
          <div data-slot="collection-toolbar-trailing" className={styles.trailing}>
            {metadata != null && (
              <div data-slot="collection-toolbar-metadata" className={styles.metadata}>
                {metadata}
              </div>
            )}
            {actions != null && (
              <div data-slot="collection-toolbar-actions" className={styles.actions}>
                {actions}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);
