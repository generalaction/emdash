import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import * as styles from './list-page.css';

export type ListPageProps = React.HTMLAttributes<HTMLDivElement>;

function ListPageRoot({ className, ...props }: ListPageProps) {
  return <div data-slot="list-page" className={cx(styles.root, className)} {...props} />;
}

export type ListPageBodyProps = React.HTMLAttributes<HTMLDivElement>;

function Body({ className, ...props }: ListPageBodyProps) {
  return <div data-slot="list-page-body" className={cx(styles.body, className)} {...props} />;
}

export { Body, ListPageRoot };
