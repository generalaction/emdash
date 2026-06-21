import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { textShimmer } from '../../../styles/effects.css';
import { vars } from '../../../styles/theme.css';
import { createVariableThemeContract } from '../../../styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type PlanStyleVars = {
  height: number;
  padX: number;
  padY: number;
  iconBox: number;
  iconGap: number;
  entryGap: number;
  border: number;
};

export const planVars = createVariableThemeContract<PlanStyleVars>({
  height: null,
  padX: null,
  padY: null,
  iconBox: null,
  iconGap: null,
  entryGap: null,
  border: null,
});

export const planRoot = style({ height: planVars.height });

export const planCard = style({
  border: `1px solid ${vars.border}`,
  borderRadius: '8px',
  overflow: 'hidden',
  boxSizing: 'border-box',
});

export const planHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  paddingLeft: planVars.padX,
  paddingRight: planVars.padX,
  cursor: 'pointer',
  color: vars.fgMuted,
  fontSize: '0.875rem',
  borderBottom: `1px solid ${vars.border}`,
  transition: 'background 150ms',
  userSelect: 'none',
  selectors: {
    '&:hover': { background: vars.bg3 },
  },
});

export const chevron = recipe({
  base: {
    display: 'inline-block',
    fontSize: '10px',
    transition: 'transform 150ms ease-out',
  },
  variants: {
    expanded: {
      true: { transform: 'rotate(90deg)' },
      false: {},
    },
  },
});

export { textShimmer };
