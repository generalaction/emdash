import { cx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import * as React from 'react';
import * as styles from './settings.css';

export interface SettingsCardProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * SettingsCard — a neutral, rounded surface for grouping related settings.
 *
 * Uses the base surface level so it reads grayish in light mode and slightly
 * elevated in dark mode. Callers add their own header markup when needed.
 * `className` is applied to the rendered card root.
 */
export function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <div
      data-slot="settings-card"
      className={cx(surface({ level: 'base' }), styles.card, className)}
    >
      <div data-slot="settings-card-body" className={styles.body}>
        {children}
      </div>
    </div>
  );
}
