import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';

export const radioOptions = recipe({
  variants: {
    layout: {
      row: {
        gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))',
      },
      stack: {
        gridTemplateColumns: '1fr',
      },
    },
  },
  defaultVariants: {
    layout: 'stack',
  },
});

export const radioOption = recipe({
  base: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: tokens.typography.size.sm,
    fontWeight: 400,
  },
  variants: {
    disabled: {
      true: {
        cursor: 'not-allowed',
      },
      false: {
        cursor: 'pointer',
      },
    },
  },
  defaultVariants: {
    disabled: false,
  },
});
