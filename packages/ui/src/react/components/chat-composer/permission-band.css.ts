import { tokens } from '@emdash/theme';
import { style, sx } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

export const band = style([
  sx({
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space.step3,
    px: tokens.space.step3,
    py: tokens.space.step2,
  }),
  {
    borderRadius: `${tokens.radius.xl} ${tokens.radius.xl} 0 0`,
    border: `1px solid ${tokens.border.default}`,
    borderBottomWidth: 0,
    backgroundColor: tokens.surface.current.emphasis,
    color: tokens.foreground.default,
    fontSize: tokens.typography.size.xs,
  },
]);

export const bandIcon = style({
  flexShrink: 0,
  color: tokens.foreground.muted,
  vars: {
    [iconSizeVar]: '0.875rem',
  },
});

export const bandLabel = style({
  flex: 1,
  minWidth: 0,
  display: '-webkit-box',
  overflow: 'hidden',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  lineHeight: 1.375,
  color: tokens.foreground.muted,
});

export const bandLabelStrong = style({
  fontWeight: 400,
  color: tokens.foreground.default,
});

export const bandCounter = style({
  marginLeft: '0.375rem',
  opacity: 0.6,
});

export const bandAction = style({
  flexShrink: 0,
});
