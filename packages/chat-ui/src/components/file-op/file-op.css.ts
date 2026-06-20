import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';
import { sx } from '../../styles/sprinkles.css';

export const fileRowItem = sx({
  display: 'flex',
  alignItems: 'center',
  gap: '1.5',
  color: 'fgPassive',
  fontSize: 'sm',
});

export const fileRowItemClickable = style({
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: vars.fgMuted },
  },
});

export const fileOpHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
  color: vars.fgPassive,
  fontSize: '0.875rem',
  userSelect: 'none',
  selectors: {
    '&:hover': { color: vars.fgMuted },
  },
});

export const monoRunning = style({
  fontFamily: 'monospace',
  fontSize: '0.875rem',
  color: vars.fgPassive,
});

/** Single-file op wrapper — flex row, full height. */
export const singleOpRow = style({
  display: 'flex',
  alignItems: 'center',
});

export const chevronSm = style({
  display: 'inline-block',
  fontSize: '10px',
  transition: 'transform 150ms ease-out',
});

export const chevronSmExpanded = style({ transform: 'rotate(90deg)' });
