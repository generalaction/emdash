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
    overflowX: 'hidden',
    overflowY: 'auto',
    padding: '0.25rem',
    selectors: {
      '&[data-width="trigger"]': {
        width: popupVars.anchorWidth,
        minWidth: '12rem',
      },
      '&[data-width="content"]': {
        width: 'max-content',
        minWidth: '12rem',
      },
      '&[data-width="content-at-least-trigger"]': {
        width: 'max-content',
        minWidth: `max(12rem, ${popupVars.anchorWidth})`,
      },
      '&[data-slot="dropdown-menu-sub-content"][data-width="content"]': {
        minWidth: '6rem',
      },
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

export const menuItemIndicator = style({
  pointerEvents: 'none',
  position: 'absolute',
  right: '0.5rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const menuSubTriggerIndicator = style({
  marginLeft: 'auto',
});

export const menuSeparator = style({
  marginLeft: '-0.25rem',
  marginRight: '-0.25rem',
  marginTop: '0.25rem',
  marginBottom: '0.25rem',
  height: '1px',
  backgroundColor: tokens.border.default,
});

export const menuShortcut = style({
  marginLeft: 'auto',
  fontSize: tokens.typography.size.xs,
  letterSpacing: '0.1em',
  color: tokens.foreground.muted,
  // When the parent menu item is focused, shortcut adapts to foreground color
  selectors: {
    '[data-slot="dropdown-menu-item"]:focus &': { color: tokens.foreground.default },
  },
});
