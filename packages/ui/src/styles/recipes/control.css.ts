import { tokens } from '@emdash/theme';
import { recipe, type StyleRule } from '@styles/index';
import { iconSizeVar } from './icon-contract';

const enabledHoverSelector =
  '&:not(:disabled):not([aria-disabled="true"]):not([data-disabled]):hover';
const selectedSelector =
  '&:is([aria-pressed="true"], [aria-selected="true"], [data-pressed], [data-selected], [data-active="true"])';
const openSelector = '&:is([aria-expanded="true"], [data-popup-open], [data-panel-open])';
const disabledSelector = '&:is(:disabled, [aria-disabled="true"], [data-disabled])';
const invalidSelector = '&:is([aria-invalid="true"], [data-invalid])';
const invalidFocusSelector = '&:is([aria-invalid="true"], [data-invalid]):focus-visible';

const focusRing = {
  borderColor: tokens.border.focus,
  boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
} as const;

const invalidFocusRing = {
  borderColor: tokens.border.destructive,
  boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.destructive} 20%, transparent)`,
} as const;

const secondaryBackground = `color-mix(in srgb, ${tokens.foreground.default} 6%, transparent)`;
const secondaryBackgroundHover = `color-mix(in srgb, ${tokens.foreground.default} 9%, transparent)`;
const secondaryBackgroundSelected = `color-mix(in srgb, ${tokens.foreground.default} 12%, transparent)`;
const primaryBackgroundPressed = `color-mix(in srgb, black 10%, ${tokens.palette.accent.step9})`;

interface ToneVisuals {
  background: string;
  border: string;
  foreground: string;
  hover: string;
  selected: string;
}

function toneVariant(tone: ToneVisuals): StyleRule {
  return {
    color: tone.foreground,
    selectors: {
      [enabledHoverSelector]: {
        backgroundColor: tone.hover,
        color: tone.foreground,
      },
      '&:active': {
        backgroundColor: tone.selected,
        color: tone.foreground,
      },
      [selectedSelector]: {
        backgroundColor: tone.selected,
        color: tone.foreground,
      },
      [openSelector]: {
        backgroundColor: tone.selected,
        color: tone.foreground,
      },
      '&:focus-visible': {
        borderColor: tone.border,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${tone.border} 20%, transparent)`,
      },
    },
  };
}

function filledTone(tone: ToneVisuals): StyleRule {
  return {
    backgroundColor: tone.background,
    borderColor: tone.border,
    color: tone.foreground,
  };
}

const flatTone: StyleRule = {
  backgroundColor: 'transparent',
  selectors: {
    [enabledHoverSelector]: { backgroundColor: 'transparent' },
    '&:active': { backgroundColor: 'transparent' },
    [selectedSelector]: { backgroundColor: 'transparent' },
    [openSelector]: { backgroundColor: 'transparent' },
  },
};

const destructiveTone = {
  background: tokens.surface.tone.destructive.background,
  border: tokens.surface.tone.destructive.border,
  foreground: tokens.surface.tone.destructive.foreground,
  hover: tokens.surface.tone.destructive.hover,
  selected: tokens.surface.tone.destructive.selected,
} satisfies ToneVisuals;

const warningTone = {
  background: tokens.surface.tone.warning.background,
  border: tokens.surface.tone.warning.border,
  foreground: tokens.surface.tone.warning.foreground,
  hover: tokens.surface.tone.warning.hover,
  selected: tokens.surface.tone.warning.selected,
} satisfies ToneVisuals;

const infoTone = {
  background: tokens.surface.tone.info.background,
  border: tokens.surface.tone.info.border,
  foreground: tokens.surface.tone.info.foreground,
  hover: tokens.surface.tone.info.hover,
  selected: tokens.surface.tone.info.selected,
} satisfies ToneVisuals;

const successTone = {
  background: tokens.surface.tone.success.background,
  border: tokens.surface.tone.success.border,
  foreground: tokens.surface.tone.success.foreground,
  hover: tokens.surface.tone.success.hover,
  selected: tokens.surface.tone.success.selected,
} satisfies ToneVisuals;

/**
 * Private implementation for the public `control()` Recipe.
 *
 * The base owns every shared interaction selector. Component Recipes compose
 * this class and add only anatomy that is unique to that component.
 */
export const controlRecipe = recipe({
  base: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid transparent',
    borderRadius: tokens.radius.lg,
    backgroundClip: 'padding-box',
    fontSize: tokens.typography.size.sm,
    fontWeight: 400,
    whiteSpace: 'nowrap',
    outline: 'none',
    userSelect: 'none',
    transition: 'all 150ms',
    vars: {
      [iconSizeVar]: '1rem',
    },
    selectors: {
      '&:focus-visible': focusRing,
      [disabledSelector]: {
        pointerEvents: 'none',
        opacity: 0.5,
      },
      [invalidSelector]: {
        borderColor: tokens.border.destructive,
      },
      [invalidFocusSelector]: invalidFocusRing,
    },
  },

  variants: {
    emphasis: {
      minimal: {
        backgroundColor: 'transparent',
        color: tokens.foreground.muted,
        selectors: {
          [enabledHoverSelector]: {
            backgroundColor: 'transparent',
            color: tokens.foreground.default,
          },
          '&:active': {
            backgroundColor: 'transparent',
            color: tokens.foreground.default,
          },
          [selectedSelector]: {
            backgroundColor: 'transparent',
            color: tokens.foreground.default,
          },
          [openSelector]: {
            backgroundColor: 'transparent',
            color: tokens.foreground.default,
          },
        },
      },
      low: {
        backgroundColor: 'transparent',
        color: tokens.foreground.muted,
        selectors: {
          [enabledHoverSelector]: {
            backgroundColor: tokens.surface.current.hover,
            color: tokens.foreground.default,
          },
          '&:active': {
            backgroundColor: tokens.surface.current.selected,
            color: tokens.foreground.default,
          },
          [selectedSelector]: {
            backgroundColor: tokens.surface.current.selected,
            color: tokens.foreground.default,
          },
          [openSelector]: {
            backgroundColor: tokens.surface.current.selected,
            color: tokens.foreground.default,
          },
        },
      },
      medium: {
        backgroundColor: secondaryBackground,
        borderColor: tokens.border.default,
        color: tokens.foreground.muted,
        selectors: {
          [enabledHoverSelector]: {
            backgroundColor: secondaryBackgroundHover,
            color: tokens.foreground.muted,
          },
          '&:active': {
            backgroundColor: secondaryBackgroundSelected,
            color: tokens.foreground.muted,
          },
          [selectedSelector]: {
            backgroundColor: secondaryBackgroundSelected,
            color: tokens.foreground.muted,
          },
          [openSelector]: {
            backgroundColor: secondaryBackgroundSelected,
            color: tokens.foreground.muted,
          },
        },
      },
      high: {
        backgroundColor: tokens.palette.accent.step9,
        borderColor: tokens.palette.accent.step7,
        color: tokens.palette.accent.contrast,
        selectors: {
          [enabledHoverSelector]: {
            backgroundColor: tokens.palette.accent.step10,
          },
          '&:active': {
            backgroundColor: primaryBackgroundPressed,
          },
          [selectedSelector]: {
            backgroundColor: primaryBackgroundPressed,
          },
          [openSelector]: {
            backgroundColor: tokens.palette.accent.step10,
          },
        },
      },
    },

    tone: {
      neutral: {},
      destructive: toneVariant(destructiveTone),
      warning: toneVariant(warningTone),
      info: toneVariant(infoTone),
      success: toneVariant(successTone),
    },

    size: {
      xs: {
        height: '1.5rem',
        gap: '0.25rem',
        paddingLeft: '0.5rem',
        paddingRight: '0.5rem',
        borderRadius: tokens.radius.md,
        fontSize: tokens.typography.size.xs,
        vars: {
          [iconSizeVar]: '0.75rem',
        },
      },
      sm: {
        height: '1.75rem',
        gap: '0.25rem',
        paddingLeft: '0.625rem',
        paddingRight: '0.625rem',
        borderRadius: tokens.radius.md,
      },
      base: {
        height: '2rem',
        gap: '0.375rem',
        paddingLeft: '0.625rem',
        paddingRight: '0.625rem',
      },
      lg: {
        height: '2.5rem',
        gap: '0.375rem',
        paddingLeft: '0.625rem',
        paddingRight: '0.625rem',
      },
    },

    iconOnly: {
      true: {},
      false: {},
    },
  },

  compoundVariants: [
    {
      variants: { emphasis: 'minimal', tone: 'destructive' },
      style: flatTone,
    },
    {
      variants: { emphasis: 'minimal', tone: 'warning' },
      style: flatTone,
    },
    {
      variants: { emphasis: 'minimal', tone: 'info' },
      style: flatTone,
    },
    {
      variants: { emphasis: 'minimal', tone: 'success' },
      style: flatTone,
    },
    {
      variants: { emphasis: 'medium', tone: 'destructive' },
      style: filledTone(destructiveTone),
    },
    {
      variants: { emphasis: 'medium', tone: 'warning' },
      style: filledTone(warningTone),
    },
    {
      variants: { emphasis: 'medium', tone: 'info' },
      style: filledTone(infoTone),
    },
    {
      variants: { emphasis: 'medium', tone: 'success' },
      style: filledTone(successTone),
    },
    {
      variants: { emphasis: 'high', tone: 'destructive' },
      style: filledTone(destructiveTone),
    },
    {
      variants: { emphasis: 'high', tone: 'warning' },
      style: filledTone(warningTone),
    },
    {
      variants: { emphasis: 'high', tone: 'info' },
      style: filledTone(infoTone),
    },
    {
      variants: { emphasis: 'high', tone: 'success' },
      style: filledTone(successTone),
    },
    {
      variants: { iconOnly: true, size: 'xs' },
      style: {
        width: '1.5rem',
        height: '1.5rem',
        paddingLeft: 0,
        paddingRight: 0,
      },
    },
    {
      variants: { iconOnly: true, size: 'sm' },
      style: {
        width: '1.75rem',
        height: '1.75rem',
        paddingLeft: 0,
        paddingRight: 0,
      },
    },
    {
      variants: { iconOnly: true, size: 'base' },
      style: {
        width: '2rem',
        height: '2rem',
        paddingLeft: 0,
        paddingRight: 0,
      },
    },
    {
      variants: { iconOnly: true, size: 'lg' },
      style: {
        width: '2.5rem',
        height: '2.5rem',
        paddingLeft: 0,
        paddingRight: 0,
      },
    },
  ],

  defaultVariants: {
    emphasis: 'low',
    tone: 'neutral',
    size: 'base',
    iconOnly: false,
  },
});
