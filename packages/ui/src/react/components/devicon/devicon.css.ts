import { style } from '@styles/index';

export const deviconAdapter = style({
  display: 'inline-flex',
  width: 'var(--_devicon-size, 1rem)',
  height: 'var(--_devicon-size, 1rem)',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--_devicon-size, 1rem)',
  lineHeight: 1,
  verticalAlign: 'middle',
});
