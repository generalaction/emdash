export type ContextBarPosition = 'top' | 'bottom' | 'hidden';
export type ContextBarAlignment = 'left' | 'center' | 'right';

export const CONTEXT_BAR_POSITIONS: readonly ContextBarPosition[] = ['top', 'bottom', 'hidden'];
export const CONTEXT_BAR_ALIGNMENTS: readonly ContextBarAlignment[] = ['left', 'center', 'right'];

/**
 * Resolve a stored context-bar layout into the two-axis model (position + alignment),
 * tolerating the legacy single-axis values where 'left'/'right' implied "docked at the
 * bottom, aligned to that edge". Those values only ever existed in local dev settings
 * (the context bar shipped unreleased), so normalizing here self-heals them on next write.
 */
export function resolveContextBarLayout(
  position: string | undefined,
  alignment: string | undefined
): { position: ContextBarPosition; alignment: ContextBarAlignment } {
  if (position === 'left' || position === 'right') {
    return { position: 'bottom', alignment: position };
  }
  return {
    position:
      position === 'top' || position === 'bottom' || position === 'hidden' ? position : 'bottom',
    alignment:
      alignment === 'left' || alignment === 'center' || alignment === 'right'
        ? alignment
        : 'center',
  };
}
