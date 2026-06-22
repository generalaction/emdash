import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';

/** TabsList container strip. */
export const tabsList = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.125rem',
  borderRadius: 'var(--radius-lg)',
  backgroundColor: vars.surface,
  padding: '0.125rem',
});

/** TabsPanel — only needs outline:none (focus). */
export const tabsPanel = style({
  outline: 'none',
});

/**
 * TabsIndicator — animated underline / pill driven by base-ui CSS vars.
 * --active-tab-width and --active-tab-left are set by base-ui at runtime.
 */
export const tabsIndicator = style({
  position: 'absolute',
  bottom: 0,
  left: 0,
  height: '0.125rem',
  width: 'var(--active-tab-width)',
  transform: 'translateX(var(--active-tab-left))',
  borderRadius: 'var(--radius-full)',
  backgroundColor: vars.foreground,
  transition: 'all 150ms',
});
