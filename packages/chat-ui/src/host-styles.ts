/**
 * Stable CSS property boundary hosts satisfy when embedding Chat UI.
 *
 * Measurement-coupled `--chat-type-*` and `--chat-*-pad-*` properties remain
 * private to Chat UI's runtime configuration and are intentionally omitted.
 */
export const chatHostProperties = {
  foreground: '--chat-fg',
  foregroundBody: '--chat-fg-body',
  foregroundMuted: '--chat-fg-muted',
  foregroundPassive: '--chat-fg-passive',
  background: '--chat-bg',
  backgroundSubtle: '--chat-bg-1',
  backgroundMuted: '--chat-bg-2',
  backgroundStrong: '--chat-bg-3',
  border: '--chat-border',
  userCardBackground: '--chat-user-card-bg',
  userCardBorder: '--chat-user-card-border',
  userCardBorderHover: '--chat-user-card-border-hover',
  mentionChipBackground: '--chat-mention-chip-bg',
  mentionChipForeground: '--chat-mention-chip-fg',
  mentionFileBackground: '--chat-mention-file-bg',
  mentionFileForeground: '--chat-mention-file-fg',
  mentionIssueBackground: '--chat-mention-issue-bg',
  mentionIssueForeground: '--chat-mention-issue-fg',
  mentionSymbolBackground: '--chat-mention-symbol-bg',
  mentionSymbolForeground: '--chat-mention-symbol-fg',
  mentionCustomBackground: '--chat-mention-custom-bg',
  mentionCustomForeground: '--chat-mention-custom-fg',
  diffAdded: '--chat-diff-added',
  diffDeleted: '--chat-diff-deleted',
  diffModified: '--chat-diff-modified',
  foregroundError: '--chat-fg-error',
  link: '--chat-link',
  userBubbleBackground: '--chat-bubble-user',
  userBubbleForeground: '--chat-bubble-user-fg',
  mentionBackground: '--chat-mention-bg',
  mentionForeground: '--chat-mention-fg',
  codeBackground: '--chat-code-bg',
  inlineCodeBackground: '--chat-code-inline-bg',
  tableHeaderBackground: '--chat-table-header-bg',
  planDone: '--chat-plan-done',
  planActive: '--chat-plan-active',
  fontSans: '--chat-font-sans',
  fontMono: '--chat-font-mono',
  radiusSmall: '--chat-radius-sm',
  radiusMedium: '--chat-radius-md',
  radiusLarge: '--chat-radius-lg',
  radiusExtraLarge: '--chat-radius-xl',
  radiusFull: '--chat-radius-full',
} as const;

export type ChatHostProperty = (typeof chatHostProperties)[keyof typeof chatHostProperties];
