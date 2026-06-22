import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';

export const imageContainer = style({
  display: 'flex',
  minHeight: 0,
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  padding: '1rem',
  paddingTop: 0,
});

export const image = style({
  maxHeight: '100%',
  maxWidth: '100%',
  objectFit: 'contain',
});

export const unavailable = style({
  fontSize: 'var(--text-sm)',
  color: vars.foregroundMuted,
});
