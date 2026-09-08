import { tokens } from '@emdash/theme';
import { recipe, type StyleRule } from '@styles/index';

const disabledSelector =
  '&:is(:disabled, [aria-disabled="true"], [data-disabled], [data-disabled="true"])';
const readonlySelector =
  '&:is(input, textarea):read-only, &[aria-readonly="true"], &[data-readonly]';
const invalidSelector = '&:is([aria-invalid="true"], [data-invalid])';
const selfFocusSelector = '&:focus-visible, &[data-focus-visible]';
const withinFocusSelector = '&:focus-within, &[data-focus-within]';
const invalidSelfFocusSelector =
  '&:is([aria-invalid="true"], [data-invalid]):is(:focus-visible, [data-focus-visible])';
const invalidWithinFocusSelector =
  '&:is([aria-invalid="true"], [data-invalid]):is(:focus-within, [data-focus-within])';
const enabledHoverSelector =
  '&:not(:disabled):not([aria-disabled="true"]):not([data-disabled]):not([aria-readonly="true"]):not([data-readonly]):hover';

const focusRing = {
  borderColor: tokens.border.focus,
  boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
} as const;

const invalidRing = {
  borderColor: tokens.border.destructive,
  boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.destructive} 20%, transparent)`,
} as const;

interface FieldToneVisuals {
  border: string;
  foreground: string;
}

function toneVariant(tone: FieldToneVisuals): StyleRule {
  const ring = {
    borderColor: tone.border,
    boxShadow: `0 0 0 3px color-mix(in srgb, ${tone.border} 20%, transparent)`,
  };

  return {
    borderColor: tone.border,
    color: tone.foreground,
    selectors: {
      [selfFocusSelector]: ring,
      [withinFocusSelector]: ring,
    },
  };
}

const destructiveTone = {
  border: tokens.surface.tone.destructive.border,
  foreground: tokens.surface.tone.destructive.foreground,
} satisfies FieldToneVisuals;
const warningTone = {
  border: tokens.surface.tone.warning.border,
  foreground: tokens.surface.tone.warning.foreground,
} satisfies FieldToneVisuals;
const infoTone = {
  border: tokens.surface.tone.info.border,
  foreground: tokens.surface.tone.info.foreground,
} satisfies FieldToneVisuals;
const successTone = {
  border: tokens.surface.tone.success.border,
  foreground: tokens.surface.tone.success.foreground,
} satisfies FieldToneVisuals;

/**
 * Private visual shell shared by self-focused fields and focus-within field
 * compositions. State is expressed through native state or owned data
 * attributes; consumers add only their anatomy.
 */
export const fieldShell = recipe({
  base: {
    borderRadius: tokens.radius.md,
    border: `1px solid ${tokens.border.default}`,
    backgroundColor: tokens.surface.current.input,
    color: tokens.foreground.default,
    backgroundClip: 'padding-box',
    transition: 'color 150ms, box-shadow 150ms, border-color 150ms',
    outline: 'none',
    selectors: {
      [enabledHoverSelector]: { borderColor: tokens.border.muted },
      [disabledSelector]: {
        pointerEvents: 'none',
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      [readonlySelector]: {
        cursor: 'default',
        backgroundColor: tokens.surface.current.input,
      },
      [invalidSelector]: invalidRing,
      [invalidSelfFocusSelector]: invalidRing,
      [invalidWithinFocusSelector]: invalidRing,
    },
  },
  variants: {
    interaction: {
      self: {
        selectors: {
          [selfFocusSelector]: focusRing,
        },
      },
      within: {
        selectors: {
          [withinFocusSelector]: focusRing,
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
    containment: {
      standalone: {},
      embedded: {
        margin: 0,
        borderTop: 0,
        borderRight: 0,
        borderBottom: `1px solid ${tokens.border.default}`,
        borderLeft: 0,
        borderRadius: 0,
        backgroundColor: 'transparent',
        boxShadow: 'none',
        selectors: {
          [selfFocusSelector]: { borderColor: 'inherit', boxShadow: 'none' },
          [withinFocusSelector]: { borderColor: 'inherit', boxShadow: 'none' },
        },
      },
    },
  },
  defaultVariants: {
    interaction: 'self',
    tone: 'neutral',
    containment: 'standalone',
  },
});
