import { style } from '@vanilla-extract/css';
import { vars } from '../../../theme/core/contract/contract.css';

export const editorWrapper = style({
  position: 'relative',
  width: '100%',
});

export const editorContent = style({
  width: '100%',
  outline: 'none',
});

export const editorPlaceholder = style({
  pointerEvents: 'none',
  position: 'absolute',
  top: 0,
  left: 0,
  fontSize: 'var(--text-sm)',
  userSelect: 'none',
  color: vars.foregroundPassive,
});

// These classes are assigned via TipTap editorProps.attributes.class
// Define them here so they exist in style.css without Tailwind
export const promptEditorContentClass = style({
  outline: 'none',
  fontSize: 'var(--text-sm)',
  color: vars.foreground,
  minHeight: '36px',
});
