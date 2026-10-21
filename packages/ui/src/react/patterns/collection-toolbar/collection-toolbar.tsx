import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { SearchInput, type SearchInputProps } from '../../primitives/search-input';
import { Separator, type SeparatorProps } from '../../primitives/separator';
import * as styles from './collection-toolbar.css';

export type CollectionToolbarRootProps = React.HTMLAttributes<HTMLDivElement>;

export interface CollectionToolbarSearchProps extends Omit<
  SearchInputProps,
  'aria-label' | 'defaultValue' | 'onChange' | 'onClear' | 'placeholder' | 'size' | 'value'
> {
  /** Current search query. */
  value: string;
  /** Called with the next query whenever the search field changes or is cleared. */
  onValueChange: (value: string) => void;
  /** Placeholder displayed in the search field. */
  placeholder: string;
  /** Accessible label for the search field. Defaults to `placeholder`. */
  label?: string;
}

export type CollectionToolbarGroupProps = React.HTMLAttributes<HTMLDivElement>;

export type CollectionToolbarSpacerProps = React.HTMLAttributes<HTMLDivElement>;

export type CollectionToolbarSeparatorProps = Omit<SeparatorProps, 'orientation'>;

/**
 * CollectionToolbar — a composable controls row for any collection renderer.
 * It deliberately does not depend on CollectionView, ListView, or a particular
 * list/grid implementation.
 */
const Root = React.forwardRef<HTMLDivElement, CollectionToolbarRootProps>(
  function CollectionToolbarRoot({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="collection-toolbar"
        className={cx(styles.root, className)}
        {...props}
      />
    );
  }
);

const Search = React.forwardRef<HTMLInputElement, CollectionToolbarSearchProps>(
  function CollectionToolbarSearch(
    { value, onValueChange, placeholder, label = placeholder, ...props },
    ref
  ) {
    return (
      <div data-slot="collection-toolbar-search" className={styles.search}>
        <SearchInput
          {...props}
          ref={ref}
          size="base"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onClear={() => onValueChange('')}
          placeholder={placeholder}
          aria-label={label}
        />
      </div>
    );
  }
);

function Group({ className, ...props }: CollectionToolbarGroupProps) {
  return (
    <div data-slot="collection-toolbar-group" className={cx(styles.group, className)} {...props} />
  );
}

function Spacer({ className, ...props }: CollectionToolbarSpacerProps) {
  return (
    <div
      aria-hidden="true"
      data-slot="collection-toolbar-spacer"
      className={cx(styles.spacer, className)}
      {...props}
    />
  );
}

function ToolbarSeparator({ className, ...props }: CollectionToolbarSeparatorProps) {
  return (
    <div data-slot="collection-toolbar-separator" className={styles.separator}>
      <Separator {...props} className={className} orientation="vertical" />
    </div>
  );
}

export const CollectionToolbar = {
  Root,
  Search,
  Group,
  Spacer,
  Separator: ToolbarSeparator,
};
