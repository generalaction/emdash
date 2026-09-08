import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
  gap: '0.75rem',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
});

export const item = recipe({
  base: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: '0.75rem',
    overflow: 'hidden',
    border: `1px solid ${tokens.surface.current.border}`,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface.current.background,
    padding: '1rem',
    color: tokens.foreground.default,
    textAlign: 'left',
    transition: 'background-color 150ms, border-color 150ms, box-shadow 150ms',
    selectors: {
      '&:focus-visible': {
        outline: 'none',
        borderColor: tokens.border.focus,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
      },
    },
  },
  variants: {
    interactive: {
      true: {
        cursor: 'pointer',
        selectors: {
          '&:hover:not([data-disabled])': {
            backgroundColor: tokens.surface.current.hover,
          },
        },
      },
    },
    selected: {
      true: {
        backgroundColor: tokens.surface.current.selected,
        selectors: {
          '&:hover:not([data-disabled])': {
            backgroundColor: tokens.surface.current.selected,
          },
        },
      },
    },
    disabled: {
      true: {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
  },
  defaultVariants: {
    interactive: false,
    selected: false,
    disabled: false,
  },
});
