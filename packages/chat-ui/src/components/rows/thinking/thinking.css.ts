import { style } from '@vanilla-extract/css';
import { createVariableThemeContract } from '../../../styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ThinkingStyleVars = {
  height: number;
  padY: number;
};

export const thinkingCardVars = createVariableThemeContract<ThinkingStyleVars>({
  height: null,
  padY: null,
});

export const thinkingRoot = style({ height: thinkingCardVars.height });
