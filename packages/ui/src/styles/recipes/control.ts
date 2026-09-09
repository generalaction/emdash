import { controlRecipe } from './control.css';

export const CONTROL_EMPHASES = ['minimal', 'low', 'medium', 'high'] as const;
export const CONTROL_SIZES = ['xs', 'sm', 'base', 'lg'] as const;
export const CONTROL_TONES = ['neutral', 'destructive', 'warning', 'info', 'success'] as const;

export type ControlEmphasis = (typeof CONTROL_EMPHASES)[number];
export type ControlSize = (typeof CONTROL_SIZES)[number];
export type ControlTone = (typeof CONTROL_TONES)[number];

export interface ControlOptions {
  /** Visual prominence relative to neighboring controls. @default 'low' */
  emphasis?: ControlEmphasis;
  /** Shared four-step control size. @default 'base' */
  size?: ControlSize;
  /** Semantic status intent. @default 'neutral' */
  tone?: ControlTone;
  /** Makes the selected size square and removes inline padding. @default false */
  iconOnly?: boolean;
}

/**
 * Returns the complete shared class for an interactive control.
 *
 * The Recipe owns size, tone, emphasis, and native/Base UI interaction states:
 * hover, focus-visible, selected/pressed/open, disabled, and invalid. Put the
 * returned class on the interactive root. Components may add anatomy-only
 * classes; callers pass finite static overrides through
 * `className={sx({...})}` on the component root.
 *
 * @example
 * ```ts
 * export const toolbarAction = style([
 *   control({ emphasis: 'low', size: 'sm' }),
 *   { flexShrink: 0 },
 * ]);
 * ```
 */
export function control(options: ControlOptions = {}): string {
  return controlRecipe(options);
}
