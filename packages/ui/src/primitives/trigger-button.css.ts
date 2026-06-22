import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';

/** Extra styles applied on top of controlVariants for TriggerButton. */
export const triggerButtonExtra = style({
  width: 'fit-content',
  justifyContent: 'space-between',
  gap: '0.375rem',
  selectors: {
    '&[data-placeholder]': { color: vars.foregroundPassive },
  },
});
globalStyle(`${triggerButtonExtra} > [data-slot="trigger-value"]`, {
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});
