import { style } from '@vanilla-extract/css';
import { textShimmer } from '@styles/effects.css';
import { sx } from '@styles/sprinkles.css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ToolStyleVars = { rowH: number };

export const toolVars = createVariableThemeContract<ToolStyleVars>({ rowH: null });

export const toolRoot = style([
  sx({ display: 'flex', alignItems: 'center', borderColor: 'border' }),
  // overflow:hidden ensures content never escapes the reserved rowH.
  { height: toolVars.rowH, overflow: 'hidden' },
]);

export const toolRow = style([
  sx({ display: 'flex', alignItems: 'center', gap: '1.5', color: 'fgPassive', userSelect: 'none' }),
  // min-width:0 lets flex children shrink below their intrinsic width so
  // text-overflow ellipsis can take effect on the name and summary spans.
  { minWidth: 0 },
]);

export const toolName = style({
  fontSize: vars.typeBodyFontSize,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexShrink: 1,
  minWidth: 0,
});

export const toolSummary = style([
  {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0.75,
  },
  toolName,
]);

export { textShimmer };
