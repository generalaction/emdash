import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
// Side-effect import so the @layer order declaration is emitted before these
// rules; otherwise `recipes` gets registered first and loses to app layers.

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  minHeight: 0,
  width: '100%',
  padding: '2rem',
  backgroundColor: tokens.palette.neutral.step1,
});

export const bare = style({
  backgroundColor: 'transparent',
});

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  maxWidth: '20rem',
});

export const label = style({
  margin: 0,
  fontFamily: tokens.typography.family.sans,
  fontSize: tokens.typography.size.sm,
  fontWeight: 500,
  color: tokens.foreground.muted,
});

export const description = style({
  margin: 0,
  marginTop: '0.375rem',
  fontSize: tokens.typography.size.xs,
  lineHeight: 1.625,
  fontWeight: 400,
  color: tokens.foreground.passive,
});

export const action = style({
  marginTop: '1.25rem',
});
