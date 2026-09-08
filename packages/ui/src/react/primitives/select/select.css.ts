import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { popup } from '@styles/recipes/popup';
import { popupVars } from '@styles/recipes/popup-contract';

export const positioner = style({
  isolation: 'isolate',
  zIndex: 50,
});

export const selectGroup = style({
  scrollMarginTop: '0.25rem',
  scrollMarginBottom: '0.25rem',
  padding: '0.25rem',
});

export const selectValue = style({
  display: 'flex',
  flex: 1,
  textAlign: 'left',
});

export const selectContent = style([
  popup({ shadow: 'md' }),
  {
    position: 'relative',
    isolation: 'isolate',
    maxHeight: popupVars.availableHeight,
    maxWidth: popupVars.availableWidth,
    overflowX: 'hidden',
    overflowY: 'auto',
    padding: '2px',
    selectors: {
      '&[data-width="trigger"]': {
        width: popupVars.anchorWidth,
        minWidth: popupVars.anchorWidth,
      },
      '&[data-width="content"]': {
        width: 'max-content',
        minWidth: '9rem',
      },
      '&[data-width="content-at-least-trigger"]': {
        width: 'max-content',
        minWidth: `max(9rem, ${popupVars.anchorWidth})`,
      },
      // When aligned with trigger, skip the popup animation
      '&[data-align-trigger="true"]': { animation: 'none' },
    },
  },
]);

export const selectLabel = style({
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const selectItemText = style({
  display: 'flex',
  minWidth: 0,
  flex: 1,
  alignItems: 'center',
  gap: '0.5rem',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const selectItemIndicator = style({
  pointerEvents: 'none',
  position: 'absolute',
  right: '0.5rem',
  display: 'flex',
  width: '1rem',
  height: '1rem',
  alignItems: 'center',
  justifyContent: 'center',
});

export const selectSeparator = style({
  pointerEvents: 'none',
  marginLeft: '-0.25rem',
  marginRight: '-0.25rem',
  marginTop: '0.25rem',
  marginBottom: '0.25rem',
  height: '1px',
  backgroundColor: tokens.border.default,
});

export const scrollButton = style({
  zIndex: 10,
  display: 'flex',
  width: '100%',
  cursor: 'default',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: tokens.surface.current.background,
  paddingTop: '0.25rem',
  paddingBottom: '0.25rem',
});
