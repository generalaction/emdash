import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';

const cardInnerRadius = `calc(${vars.radiusLg} - 1px)`;

// Uses content-box intentionally: the borderBottom is counted by card chrome
// measurement helpers as the header separator.
export const cardHeader = style({
  display: 'flex',
  appearance: 'none',
  boxSizing: 'content-box',
  width: 'calc(100% - 16px)',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '6px',
  margin: 0,
  padding: '0 8px',
  background: 'transparent',
  border: 0,
  borderRadius: cardInnerRadius,
  cursor: 'pointer',
  color: vars.fgMuted,
  font: 'inherit',
  fontSize: vars.typeBodyFontSize,
  letterSpacing: 'inherit',
  textAlign: 'left',
  textTransform: 'inherit',
  transition: 'background 150ms',
  userSelect: 'none',
  selectors: {
    '&[data-body-visible]': {
      borderBottom: `1px solid ${vars.border}`,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    '&:focus-visible': {
      boxShadow: 'inset 0 0 0 2px currentColor',
      outline: '2px solid transparent',
      outlineOffset: '-2px',
    },
    '&:hover': { background: vars.bg3 },
  },
});

export const cardHeaderLeft = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  minWidth: 0,
});

export const cardHeaderTitle = style({
  minWidth: 0,
});

export const cardHeaderRight = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexShrink: 0,
});

export const cardLeadingSlot = style({
  position: 'relative',
  width: '14px',
  height: '14px',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const cardLeadingIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'opacity 120ms ease-out',
  selectors: {
    [`${cardHeader}:hover &`]: { opacity: 0 },
  },
});

export const cardHoverChevron = style({
  position: 'absolute',
  inset: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '10px',
  opacity: 0,
  transition: 'opacity 120ms ease-out, transform 150ms ease-out',
  selectors: {
    [`${cardHeader}:hover &`]: { opacity: 1 },
  },
});

export const cardChevronExpanded = style({
  transform: 'rotate(90deg)',
});

export const cardErrorIcon = style({
  display: 'flex',
  color: vars.fgError,
});

export const cardPermissionIcon = style({
  display: 'flex',
  color: '#eab308',
});
