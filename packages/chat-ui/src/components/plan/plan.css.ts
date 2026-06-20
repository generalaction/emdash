import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';
import { textShimmer } from '../../styles/effects.css';

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
  paddingLeft: '8px',
  paddingRight: '8px',
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

export const chevronPlan = style({
  display: 'inline-block',
  fontSize: '10px',
  transition: 'transform 150ms ease-out',
});

export const chevronPlanExpanded = style({ transform: 'rotate(90deg)' });

export { textShimmer };
