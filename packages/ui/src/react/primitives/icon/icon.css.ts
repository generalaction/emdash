import { recipe } from '@styles/index';
import type { VariantProps } from '@styles/index';
import { iconSizeVar } from '../../../styles/recipes/icon-contract';

const iconSizes = {
  xs: { width: '0.75rem', height: '0.75rem' },
  sm: { width: '0.875rem', height: '0.875rem' },
  md: { width: '1rem', height: '1rem' },
  lg: { width: '1.25rem', height: '1.25rem' },
  xl: { width: '1.5rem', height: '1.5rem' },
} as const;

const inheritedIconSize = `var(${iconSizeVar}, 1rem)`;

export const icon = recipe({
  base: {
    display: 'inline-block',
    flexShrink: 0,
    color: 'currentColor',
    verticalAlign: 'middle',
    width: inheritedIconSize,
    height: inheritedIconSize,
  },
  variants: {
    size: iconSizes,
  },
});

export const iconSlot = recipe({
  base: {
    width: inheritedIconSize,
    height: inheritedIconSize,
  },
  variants: {
    size: iconSizes,
  },
});

export type IconVariants = NonNullable<VariantProps<typeof icon>>;
