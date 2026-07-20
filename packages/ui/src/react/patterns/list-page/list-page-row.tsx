import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import * as styles from './list-page-row.css';

type ListPageRowCommonProps = {
  /** Whether the row has hover/click affordance. Defaults to true when `onClick` is provided. */
  interactive?: boolean;
  /** Whether the row is in a selected state. */
  selected?: boolean;
};

type ListPageButtonRowProps = ListPageRowCommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
    onClick: React.MouseEventHandler<HTMLButtonElement>;
  };

type ListPageDivRowProps = ListPageRowCommonProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> & {
    onClick?: undefined;
  };

export type ListPageRowProps = ListPageButtonRowProps | ListPageDivRowProps;

/**
 * ListPage.Row — a rounded list-page row with optional interaction and selection states.
 *
 * Providing `onClick` renders the row surface as a button. Otherwise it renders as a div.
 */
function Row(props: ListPageRowProps) {
  const interactive = props.interactive ?? props.onClick !== undefined;

  if (props.onClick) {
    const {
      children,
      className,
      interactive: _interactive,
      selected = false,
      ...buttonProps
    } = props;
    return (
      <div data-slot="list-page-row-wrapper" className={styles.rowWrapper}>
        <button
          type="button"
          data-slot="list-page-row"
          data-interactive={interactive || undefined}
          data-selected={selected || undefined}
          className={cx(styles.row({ interactive, selected }), className)}
          {...buttonProps}
        >
          {children}
        </button>
      </div>
    );
  }

  const { children, className, interactive: _interactive, selected = false, ...divProps } = props;
  return (
    <div data-slot="list-page-row-wrapper" className={styles.rowWrapper}>
      <div
        data-slot="list-page-row"
        data-interactive={interactive || undefined}
        data-selected={selected || undefined}
        className={cx(styles.row({ interactive, selected }), className)}
        {...divProps}
      >
        {children}
      </div>
    </div>
  );
}

export type ListPageRowIconProps = React.HTMLAttributes<HTMLSpanElement>;

function RowIcon({ className, ...props }: ListPageRowIconProps) {
  return (
    <span
      data-slot="list-page-row-icon"
      className={cx(styles.rowIcon, className)}
      aria-hidden
      {...props}
    />
  );
}

export type ListPageRowContentProps = React.HTMLAttributes<HTMLSpanElement>;

function RowContent({ className, ...props }: ListPageRowContentProps) {
  return (
    <span
      data-slot="list-page-row-content"
      className={cx(styles.rowContent, className)}
      {...props}
    />
  );
}

export type ListPageRowTitleProps = React.HTMLAttributes<HTMLSpanElement>;

function RowTitle({ className, ...props }: ListPageRowTitleProps) {
  return (
    <span data-slot="list-page-row-title" className={cx(styles.rowTitle, className)} {...props} />
  );
}

export type ListPageRowDescriptionProps = React.HTMLAttributes<HTMLSpanElement>;

function RowDescription({ className, ...props }: ListPageRowDescriptionProps) {
  return (
    <span
      data-slot="list-page-row-description"
      className={cx(styles.rowDescription, className)}
      {...props}
    />
  );
}

export type ListPageRowTrailingProps = React.HTMLAttributes<HTMLSpanElement>;

function RowTrailing({ className, ...props }: ListPageRowTrailingProps) {
  return (
    <span
      data-slot="list-page-row-trailing"
      className={cx(styles.rowTrailing, className)}
      {...props}
    />
  );
}

export { Row, RowContent, RowDescription, RowIcon, RowTitle, RowTrailing };
