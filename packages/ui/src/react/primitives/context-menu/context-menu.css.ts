import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { popup } from '@styles/recipes/popup';
import { popupVars } from '@styles/recipes/popup-contract';

export const positioner = style({
  isolation: 'isolate',
  zIndex: 50,
  outline: 'none',
});

export const menuContent = style([
  popup({ shadow: 'md' }),
  {
    maxHeight: popupVars.availableHeight,
    maxWidth: popupVars.availableWidth,
    width: 'auto',
    minWidth: '10rem',
    overflowX: 'hidden',
    overflowY: 'auto',
    padding: '0.25rem',
    selectors: {
      '&[data-closed]': { overflow: 'hidden' },
    },
  },
]);

export const menuLabel = style({
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: tokens.typography.size.xs,
  fontWeight: 400,
  color: tokens.foreground.muted,
  selectors: {
    '&[data-inset]': { paddingLeft: '2rem' },
  },
});

export const menuSeparator = style({
  marginLeft: '-0.25rem',
  marginRight: '-0.25rem',
  marginTop: '0.25rem',
  marginBottom: '0.25rem',
  height: '1px',
  backgroundColor: tokens.border.default,
});
