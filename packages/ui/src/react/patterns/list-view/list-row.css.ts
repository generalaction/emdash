import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';

export const row = recipe({
  base: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    borderBottom: `1px solid ${tokens.border.default}`,
    transition: 'background-color 100ms',
    selectors: {
      '&:focus-visible': {
        outline: `2px solid ${tokens.border.focus}`,
        outlineOffset: '-2px',
      },
    },
  },
  variants: {
    interactive: {
      true: {
        cursor: 'pointer',
        selectors: {
          '&:hover:not([data-disabled])': { backgroundColor: tokens.surface.current.hover },
        },
      },
    },
    selected: {
      true: {
        backgroundColor: tokens.surface.current.selected,
        selectors: {
          '&:hover': { backgroundColor: tokens.surface.current.selected },
        },
      },
    },
    disabled: {
      true: {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
    isLast: {
      true: { borderBottom: 'none' },
    },
    divider: {
      default: {},
      subtle: { borderBottomColor: tokens.border.subtle },
    },
  },
  defaultVariants: {
    interactive: false,
    selected: false,
    disabled: false,
    isLast: false,
    divider: 'default',
  },
});

/** Inner content padding for a standard Row. */
export const rowInner = style({
  display: 'flex',
  position: 'relative',
  alignItems: 'flex-start',
  gap: '0.75rem',
  padding: '0.75rem',
});

/**
 * SectionHeader — label + optional count, used by the Agents view
 * "Recommended (4)" / "All agents (12)" pattern.
 */
export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
  paddingLeft: '1rem',
  paddingRight: '1rem',
  paddingTop: '0.5rem',
  paddingBottom: '0.25rem',
});

export const sectionHeaderLabel = style({
  fontSize: tokens.typography.size.sm,
  fontWeight: 400,
  color: tokens.foreground.default,
});

export const sectionHeaderCount = style({
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});
