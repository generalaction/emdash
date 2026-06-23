import { style } from '@vanilla-extract/css';
import { textShimmer } from '@styles/effects.css';
import { sx } from '@styles/sprinkles.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ToolStyleVars = { rowH: number };

export const toolVars = createVariableThemeContract<ToolStyleVars>({ rowH: null });

export const toolRoot = style([
  sx({ display: 'flex', alignItems: 'center', borderColor: 'border' }),
  { height: toolVars.rowH },
]);

export const toolRow = sx({
  display: 'flex',
  alignItems: 'center',
  gap: '1.5',
  color: 'fgPassive',
  userSelect: 'none',
});
export const toolName = style({ fontSize: '0.875rem' });
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
