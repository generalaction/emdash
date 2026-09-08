import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const diagramContainer = style({
  minHeight: 0,
  flex: 1,
  overflow: 'auto',
  padding: '1rem',
  paddingTop: 0,
});

export const diagram = style({
  minWidth: 0,
});

export const unavailable = style({
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
});
