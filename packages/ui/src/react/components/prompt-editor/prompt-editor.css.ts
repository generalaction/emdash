import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

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
  fontSize: tokens.typography.size.sm,
  lineHeight: 1.4,
  userSelect: 'none',
  color: tokens.foreground.passive,
});

// These classes are assigned via TipTap editorProps.attributes.class
export const promptEditorContentClass = style({
  outline: 'none',
  fontSize: tokens.typography.size.sm,
  lineHeight: 1.4,
  color: tokens.foreground.default,
  minHeight: '1.25rem',
});
