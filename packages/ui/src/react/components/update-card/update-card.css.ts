import { style } from '@vanilla-extract/css';
import '@styles/layers.css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

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
  borderRadius: tokenVars.radiusLg,
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
  fontSize: tokenVars.textBase,
  fontWeight: 400,
  color: vars.foreground,
});

export const rowDescription = style({
  display: 'flex',
  alignItems: 'center',
  fontSize: tokenVars.textSm,
  color: vars.foregroundMuted,
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
  borderRadius: tokenVars.radiusMd,
  backgroundColor: vars.backgroundError,
  color: vars.foregroundError,
});

export const errorMessage = style({
  fontSize: tokenVars.textSm,
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
  fontSize: tokenVars.textSm,
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
