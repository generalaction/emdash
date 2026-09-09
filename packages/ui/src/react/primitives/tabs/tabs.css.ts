import { style } from '@styles/index';

/** TabsList container strip. */
export const tabsList = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  selectors: {
    '&[data-orientation="vertical"]': {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '1px',
    },
  },
});

/** TabsPanel — only needs outline:none (focus). */
export const tabsPanel = style({
  outline: 'none',
});
