import { globalStyle, style } from '@vanilla-extract/css';

export const calloutRoot = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid',
  paddingLeft: '1rem',
  paddingRight: '1rem',
  paddingTop: '0.75rem',
  paddingBottom: '0.75rem',
  fontSize: 'var(--text-sm)',
  // Colors come from the .surface-<status> cascade class applied by Surface
  backgroundColor: 'var(--surface)',
  borderColor: 'var(--surface-border)',
  color: 'var(--surface-foreground)',
});

export const calloutIcon = style({
  marginTop: '0.125rem',
  flexShrink: 0,
});
globalStyle(`${calloutIcon} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const calloutContent = style({
  minWidth: 0,
  flex: '1 1 0%',
});
