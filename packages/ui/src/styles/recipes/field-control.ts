import { joinClassNames } from '../classnames';
import { fieldControlAnatomy } from './field-control.css';
import { fieldShell } from './field-shell.css';

export const FIELD_CONTROL_SIZES = ['sm', 'base'] as const;
export const FIELD_CONTROL_TONES = [
  'neutral',
  'destructive',
  'warning',
  'info',
  'success',
] as const;

export type FieldControlSize = (typeof FIELD_CONTROL_SIZES)[number];
export type FieldControlTone = (typeof FIELD_CONTROL_TONES)[number];

export interface FieldControlOptions {
  /** Shared text-entry size. @default 'base' */
  size?: FieldControlSize;
  /** Semantic status intent. Invalid state still takes precedence. @default 'neutral' */
  tone?: FieldControlTone;
}

/**
 * Returns the complete shared class for a field-shaped interactive control.
 *
 * The Recipe owns sizing, tone, hover, focus-visible, disabled, readonly, and
 * invalid visuals. Put the returned class on the interactive root. Components
 * may add anatomy-only classes; callers pass finite static overrides through
 * `className={sx({...})}` on the documented component root.
 *
 * @example
 * ```ts
 * export const searchField = style([
 *   fieldControl({ size: 'sm' }),
 *   { minWidth: 0 },
 * ]);
 * ```
 */
export function fieldControl({
  size = 'base',
  tone = 'neutral',
}: FieldControlOptions = {}): string {
  return joinClassNames(
    fieldShell({ interaction: 'self', containment: 'standalone', tone }),
    fieldControlAnatomy({ size })
  );
}
