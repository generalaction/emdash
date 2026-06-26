import { style } from '@vanilla-extract/css';

/** TabsList container strip. */
export const tabsList = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
});

/** TabsPanel — only needs outline:none (focus). */
export const tabsPanel = style({
  outline: 'none',
});

