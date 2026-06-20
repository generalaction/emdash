import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/theme.css';

export const inlineCodeChipVisual = style({
  borderRadius: '4px',
  background: vars.codeInlineBg,
});
