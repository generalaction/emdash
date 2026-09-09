import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const separator = style({
  flexShrink: 0,
  backgroundColor: tokens.border.default,
  selectors: {
    '&[data-orientation="horizontal"]': {
      height: '1px',
      width: '100%',
    },
    '&[data-orientation="vertical"]': {
      width: '1px',
      alignSelf: 'stretch',
    },
  },
});
