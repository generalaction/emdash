import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

export const kbd = style({
  pointerEvents: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  minWidth: '1.15rem',
  height: '1.15rem',
  width: '1rem',
  borderRadius: tokens.radius.sm,
  border: `1px solid var(--_kbd-border, ${tokens.border.subtle})`,
  backgroundColor: `var(--_kbd-bg, ${tokens.palette.neutral.step2})`,
  color: `var(--_kbd-color, ${tokens.foreground.muted})`,
  fontFamily: tokens.typography.family.sans,
  fontSize: '10px',
  fontWeight: 400,
  lineHeight: 1,
  userSelect: 'none',
  vars: {
    [iconSizeVar]: '0.75rem',
  },
});

export const kbdGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.1rem',
});
