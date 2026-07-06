import { style } from '@vanilla-extract/css';

export const splitButtonRoot = style({
  display: 'inline-flex',
  flexShrink: 0,
  alignItems: 'stretch',
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
  flexShrink: 0,
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
});

/** Left border separator between primary face and chevron in primary variant. */
export const chevronBorderLeft = style({
  borderLeft: `1px solid rgba(255,255,255,0.2)`,
});
