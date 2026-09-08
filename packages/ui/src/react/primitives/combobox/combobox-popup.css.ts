import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { popup } from '@styles/recipes/popup';

export const popupRoot = style([
  popup({ motion: 'enter' }),
  {
    minWidth: '220px',
    maxWidth: '340px',
    overflow: 'hidden',
  },
]);

export const popupHeader = style({
  borderBottom: `1px solid ${tokens.border.default}`,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const popupList = style({
  maxHeight: '240px',
  scrollPaddingTop: '0.25rem',
  scrollPaddingBottom: '0.25rem',
  overflowY: 'auto',
  padding: '0.25rem',
});

export const popupEmpty = style({
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
  textAlign: 'center',
});

export const popupItemStacked = style({
  alignItems: 'flex-start',
});

export const popupItemTextStack = style({
  display: 'flex',
  minWidth: 0,
  flex: '1 1 0%',
  flexDirection: 'column',
  gap: '0.125rem',
});

export const popupSectionHeader = style({
  paddingTop: '0.5rem',
  paddingBottom: '0.25rem',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  fontSize: tokens.typography.size.xs,
  fontWeight: 400,
  color: tokens.foreground.muted,
});

export const popupItemIcon = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  fontSize: '1em',
});

export const popupItemLabel = style({
  // Keep the primary label visible before allowing the description/path to take space.
  flexGrow: 1,
  flexShrink: 0,
  flexBasis: 'auto',
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const popupItemDescription = style({
  // High flex-shrink so the muted description ellipsizes before the (short)
  // primary label, keeping the command/mention name visible.
  flexGrow: 0,
  flexShrink: 100,
  flexBasis: 'auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const popupDismiss = style({
  display: 'inline-flex',
  width: '1rem',
  height: '1rem',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.sm,
  opacity: 0.5,
  selectors: {
    '&:hover': { opacity: 1 },
  },
});
