import { style } from '@vanilla-extract/css';

export const deviconAdapter = style({
  display: 'inline-flex',
  width: 'var(--_chat-devicon-size, 0.75rem)',
  height: 'var(--_chat-devicon-size, 0.75rem)',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--_chat-devicon-size, 0.75rem)',
  lineHeight: 1,
});
