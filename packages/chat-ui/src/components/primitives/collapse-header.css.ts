import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';
import { sx } from '../../styles/sprinkles.css';

export const collapseRow = sx({
  display: 'flex',
  alignItems: 'center',
  gap: '1.5',
  cursor: 'pointer',
  color: 'fgPassive',
  userSelect: 'none',
});

export const collapseRowHover = style({
  selectors: {
    '&:hover': { color: vars.fgMuted },
  },
});

/** Combined class for the header row element. */
export const collapseHeader = style([collapseRow, collapseRowHover, { fontSize: '0.875rem' }]);

export const chevron = style({
  display: 'inline-block',
  fontSize: '10px',
  transition: 'transform 150ms ease-out',
});

export const chevronExpanded = style({
  transform: 'rotate(90deg)',
});
