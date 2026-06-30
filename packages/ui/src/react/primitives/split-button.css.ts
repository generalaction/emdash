import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

export const splitButtonRoot = style({
  display: 'inline-flex',
  alignItems: 'stretch',
});

/** Tone dot indicator before option labels. */
export const toneDotNeutral = style({
  display: 'inline-block',
  width: '0.375rem',
  height: '0.375rem',
  flexShrink: 0,
  borderRadius: 'var(--radius-full)',
  backgroundColor: vars.foregroundMuted,
});

export const toneDotAccept = style({
  display: 'inline-block',
  width: '0.375rem',
  height: '0.375rem',
  flexShrink: 0,
  borderRadius: 'var(--radius-full)',
  backgroundColor: 'var(--color-success, #22c55e)',
});

export const toneDotReject = style({
  display: 'inline-block',
  width: '0.375rem',
  height: '0.375rem',
  flexShrink: 0,
  borderRadius: 'var(--radius-full)',
  backgroundColor: vars.foregroundDestructive,
});

/** Primary face: right side rounded corners removed to butt against chevron. */
export const splitButtonFace = style({
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,
  paddingRight: '0.5rem',
  paddingLeft: '0.75rem',
});

/** Chevron face: left side rounded corners removed to butt against primary face. */
export const splitButtonChevronFace = style({
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
});

/** Left border separator between primary face and chevron in primary variant. */
export const chevronBorderLeft = style({
  borderLeft: `1px solid rgba(255,255,255,0.2)`,
});
