import { style } from '@vanilla-extract/css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ThinkingStyleVars = {
  height: number;
};

export const thinkingCardVars = createVariableThemeContract<ThinkingStyleVars>({
  height: null,
});

export const thinkingRoot = style({ height: thinkingCardVars.height });
