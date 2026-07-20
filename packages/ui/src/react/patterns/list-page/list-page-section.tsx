import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import * as styles from './list-page-section.css';

export type ListPageSectionProps = React.HTMLAttributes<HTMLDivElement>;

function Section({ className, ...props }: ListPageSectionProps) {
  return (
    <section data-slot="list-page-section" className={cx(styles.section, className)} {...props} />
  );
}

export interface ListPageSectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Section label text. */
  label: React.ReactNode;
  /** Optional item count shown after the label. */
  count?: number;
}

function SectionHeader({ label, count, className, ...props }: ListPageSectionHeaderProps) {
  return (
    <div
      data-slot="list-page-section-header"
      className={cx(styles.sectionHeader, className)}
      {...props}
    >
      <span>{label}</span>
      {count !== undefined && <span>({count})</span>}
    </div>
  );
}

export type ListPageSeparatorProps = React.HTMLAttributes<HTMLDivElement>;

function Separator({ className, ...props }: ListPageSeparatorProps) {
  return (
    <div
      role="separator"
      data-slot="list-page-separator"
      className={cx(styles.separator, className)}
      {...props}
    />
  );
}

export { Section, SectionHeader, Separator };
