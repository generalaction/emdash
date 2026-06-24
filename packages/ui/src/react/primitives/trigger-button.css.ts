import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

/** Trailing chevron icon inside TriggerButton. */
export const triggerButtonChevron = style({
  pointerEvents: 'none',
  flexShrink: 0,
  color: vars.foregroundPassive,
});

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
