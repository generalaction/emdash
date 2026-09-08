import { tokens } from '@emdash/theme';
import { recipe, style } from '../index';
import type { VariantProps } from '../index';
import { sx } from '../index';

export const publicStyleFixture = style({
  outline: '2px solid currentColor',
});

export const publicRecipeFixture = recipe({
  base: {
    borderStyle: 'solid',
  },
  variants: {
    emphasis: {
      false: {
        borderWidth: 1,
      },
      true: {
        borderWidth: 2,
      },
    },
  },
  defaultVariants: {
    emphasis: false,
  },
});

export type PublicRecipeVariants = VariantProps<typeof publicRecipeFixture>;

export const publicUtilityFixture = sx({
  display: 'inline-flex',
  gap: tokens.space.step1,
  px: tokens.space.step2,
  rounded: tokens.radius.full,
  color: tokens.foreground.muted,
  background: tokens.surface.current.background,
});

export const publicContextualUtilityFixture = sx({
  color: tokens.surface.tone.destructive.level.sunken.foreground,
  background: tokens.surface.tone.info.role.paper.background,
});

if (false) {
  publicRecipeFixture({ emphasis: true });
  // @ts-expect-error The public recipe is callable-only; VE class metadata is private.
  publicRecipeFixture.classNames;
  // @ts-expect-error sx excludes arbitrary lengths from its finite Token-backed vocabulary.
  sx({ gap: '13px' });
  // @ts-expect-error sx excludes properties outside the approved compact vocabulary.
  sx({ transform: 'scale(1)' });
  // @ts-expect-error sx excludes unrestricted CSS lengths.
  sx({ width: '37px' });
}
