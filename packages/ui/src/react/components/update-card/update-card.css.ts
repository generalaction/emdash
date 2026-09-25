import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const card = style({
  minWidth: 0,
  display: 'grid',
  gap: '0.75rem',
});

export const row = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.75rem',
  width: '100%',
  borderRadius: tokens.radius.lg,
});

export const rowBody = style({
  display: 'flex',
  minWidth: 0,
  flex: '1 1 16rem',
  flexDirection: 'column',
  gap: '0.25rem',
});

export const rowTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: tokens.typography.size.base,
  fontWeight: 400,
  color: tokens.foreground.default,
});

export const rowDescription = style({
  display: 'flex',
  alignItems: 'center',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
});

export const rowControls = style({
  marginLeft: 'auto',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
});

export const errorPanel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  minWidth: 0,
  padding: '0.75rem',
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.feedback.error.background,
  color: tokens.feedback.error.foreground,
});

export const errorMessage = style({
  fontSize: tokens.typography.size.sm,
  lineHeight: 1.5,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});

export const errorActions = style({
  display: 'flex',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: '0.5rem',
});

export const errorDetails = style({
  flex: '1 1 12rem',
  minWidth: 0,
  fontSize: tokens.typography.size.sm,
});

export const errorSummary = style({
  cursor: 'pointer',
  paddingBlock: '0.25rem',
});

export const errorDetailsText = style({
  marginTop: '0.5rem',
  maxHeight: '12rem',
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  lineHeight: 1.5,
  userSelect: 'text',
});
