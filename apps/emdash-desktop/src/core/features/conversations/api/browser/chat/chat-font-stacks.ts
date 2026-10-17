/**
 * Font stacks used to render chat-ui transcripts. Declared as `--chat-font-sans` /
 * `--chat-font-mono` in src/renderer/index.css and passed to chat-ui as
 * ChatConfig.fonts when the shared ChatContext is created.
 *
 * chat-ui pre-measures every line with canvas metrics derived from these families
 * and positions fragments absolutely — there is no CSS wrapping safety net. If the
 * CSS vars and these stacks ever disagree, lines are packed with the wrong glyph
 * widths and text clips at the right edge of the transcript column.
 * src/core/features/conversations/node/chat-font-stacks.test.ts asserts both
 * sides stay identical.
 */
export const CHAT_FONT_SANS = [
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'Oxygen',
  'Ubuntu',
  'Cantarell',
  'Fira Sans',
  'Droid Sans',
  'Helvetica Neue',
  'sans-serif',
];

export const CHAT_FONT_MONO = [
  'JetBrains Mono Variable',
  'JetBrains Mono',
  'Menlo',
  'Monaco',
  'Consolas',
  'monospace',
];
