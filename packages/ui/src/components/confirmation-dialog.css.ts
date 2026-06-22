import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';

export const description = style({
  fontSize: 'var(--text-sm)',
  color: vars.foregroundMuted,
});
