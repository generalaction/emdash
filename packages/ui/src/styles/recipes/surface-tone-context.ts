import { tokens } from '@emdash/theme';

type ToneSlots = {
  readonly background: string;
  readonly hover: string;
  readonly selected: string;
  readonly border: string;
  readonly foreground: string;
};

function toneContext(name: string, fallback: ToneSlots): ToneSlots {
  return {
    background: `var(--emdash-ui-surface-${name}, ${fallback.background})`,
    hover: `var(--emdash-ui-surface-${name}-hover, ${fallback.hover})`,
    selected: `var(--emdash-ui-surface-${name}-selected, ${fallback.selected})`,
    border: `var(--emdash-ui-surface-${name}-border, ${fallback.border})`,
    foreground: `var(--emdash-ui-surface-${name}-foreground, ${fallback.foreground})`,
  };
}

export const surfaceToneContext = {
  destructive: toneContext('destructive', tokens.surface.tone.destructive),
  warning: toneContext('warning', tokens.surface.tone.warning),
  info: toneContext('info', tokens.surface.tone.info),
  success: toneContext('success', tokens.surface.tone.success),
} as const;

const toneProperties = {
  destructive: {
    background: '--emdash-ui-surface-destructive',
    hover: '--emdash-ui-surface-destructive-hover',
    selected: '--emdash-ui-surface-destructive-selected',
    border: '--emdash-ui-surface-destructive-border',
    foreground: '--emdash-ui-surface-destructive-foreground',
  },
  warning: {
    background: '--emdash-ui-surface-warning',
    hover: '--emdash-ui-surface-warning-hover',
    selected: '--emdash-ui-surface-warning-selected',
    border: '--emdash-ui-surface-warning-border',
    foreground: '--emdash-ui-surface-warning-foreground',
  },
  info: {
    background: '--emdash-ui-surface-info',
    hover: '--emdash-ui-surface-info-hover',
    selected: '--emdash-ui-surface-info-selected',
    border: '--emdash-ui-surface-info-border',
    foreground: '--emdash-ui-surface-info-foreground',
  },
  success: {
    background: '--emdash-ui-surface-success',
    hover: '--emdash-ui-surface-success-hover',
    selected: '--emdash-ui-surface-success-selected',
    border: '--emdash-ui-surface-success-border',
    foreground: '--emdash-ui-surface-success-foreground',
  },
} as const;

function bindTone(properties: ToneSlots, values: ToneSlots): Record<string, string> {
  return {
    [properties.background]: values.background,
    [properties.hover]: values.hover,
    [properties.selected]: values.selected,
    [properties.border]: values.border,
    [properties.foreground]: values.foreground,
  };
}

const { destructive, info, success, warning } = tokens.surface.tone;

/**
 * Private contextual Tone values selected by each absolute Surface context.
 * The public Theme Tone Tokens remain immutable; only these Recipe-owned
 * custom properties inherit and rebind.
 */
export const surfaceToneBindings = {
  sunken: {
    ...bindTone(toneProperties.destructive, destructive.level.sunken),
    ...bindTone(toneProperties.warning, warning.level.sunken),
    ...bindTone(toneProperties.info, info.level.sunken),
    ...bindTone(toneProperties.success, success.level.sunken),
  },
  base: {
    ...bindTone(toneProperties.destructive, destructive),
    ...bindTone(toneProperties.warning, warning),
    ...bindTone(toneProperties.info, info),
    ...bindTone(toneProperties.success, success),
  },
  raised: {
    ...bindTone(toneProperties.destructive, destructive.level.raised),
    ...bindTone(toneProperties.warning, warning.level.raised),
    ...bindTone(toneProperties.info, info.level.raised),
    ...bindTone(toneProperties.success, success.level.raised),
  },
  elevated: {
    ...bindTone(toneProperties.destructive, destructive.level.elevated),
    ...bindTone(toneProperties.warning, warning.level.elevated),
    ...bindTone(toneProperties.info, info.level.elevated),
    ...bindTone(toneProperties.success, success.level.elevated),
  },
  overlay: {
    ...bindTone(toneProperties.destructive, destructive.level.overlay),
    ...bindTone(toneProperties.warning, warning.level.overlay),
    ...bindTone(toneProperties.info, info.level.overlay),
    ...bindTone(toneProperties.success, success.level.overlay),
  },
  paper: {
    ...bindTone(toneProperties.destructive, destructive.role.paper),
    ...bindTone(toneProperties.warning, warning.role.paper),
    ...bindTone(toneProperties.info, info.role.paper),
    ...bindTone(toneProperties.success, success.role.paper),
  },
} as const;
