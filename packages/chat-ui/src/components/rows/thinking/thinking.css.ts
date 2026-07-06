import { style } from '@vanilla-extract/css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ThinkingStyleVars = {
  height: number;
};

export const thinkingCardVars = createVariableThemeContract<ThinkingStyleVars>({
  height: null,
});

// overflow: hidden ensures that any transient measure-vs-render height desync
// (e.g. during a mid-tween frame or a stale virtualizer size) degrades to
// clipped content rather than spilling over the following row.
export const thinkingRoot = style({ height: thinkingCardVars.height, overflow: 'hidden' });
