import { chatHostProperties, type ChatHostProperty } from '@emdash/chat-ui/host-styles';
import { tokens, type TokenReference } from '@emdash/theme';
import { hostAdapter } from '@emdash/ui/styles/host';

const storybookChatHostTokenValues = {
  [chatHostProperties.foreground]: tokens.foreground.default,
  [chatHostProperties.foregroundBody]: tokens.foreground.body,
  [chatHostProperties.foregroundMuted]: tokens.foreground.muted,
  [chatHostProperties.foregroundPassive]: tokens.foreground.passive,
  [chatHostProperties.background]: tokens.surface.role.paper.background,
  [chatHostProperties.backgroundSubtle]: tokens.surface.level.base.background,
  [chatHostProperties.backgroundMuted]: tokens.surface.level.base.hover,
  [chatHostProperties.backgroundStrong]: tokens.surface.level.base.selected,
  [chatHostProperties.border]: tokens.border.default,
  [chatHostProperties.userCardBackground]: tokens.surface.level.raised.background,
  [chatHostProperties.userCardBorder]: tokens.border.default,
  [chatHostProperties.userCardBorderHover]: tokens.border.muted,
  [chatHostProperties.mentionChipBackground]: tokens.surface.level.raised.hover,
  [chatHostProperties.mentionChipForeground]: tokens.foreground.default,
  [chatHostProperties.mentionFileBackground]: tokens.surface.level.raised.hover,
  [chatHostProperties.mentionFileForeground]: tokens.foreground.default,
  [chatHostProperties.mentionIssueBackground]: tokens.surface.tone.info.background,
  [chatHostProperties.mentionIssueForeground]: tokens.surface.tone.info.foreground,
  [chatHostProperties.mentionSymbolBackground]: tokens.surface.tone.info.background,
  [chatHostProperties.mentionSymbolForeground]: tokens.surface.tone.info.foreground,
  [chatHostProperties.mentionCustomBackground]: tokens.surface.level.raised.hover,
  [chatHostProperties.mentionCustomForeground]: tokens.foreground.default,
  [chatHostProperties.diffAdded]: tokens.feedback.success.foreground,
  [chatHostProperties.diffDeleted]: tokens.feedback.error.foreground,
  [chatHostProperties.diffModified]: tokens.feedback.warning.foreground,
  [chatHostProperties.foregroundError]: tokens.feedback.error.foreground,
  [chatHostProperties.link]: tokens.feedback.info.foreground,
  [chatHostProperties.userBubbleBackground]: tokens.surface.level.base.selected,
  [chatHostProperties.userBubbleForeground]: tokens.foreground.default,
  [chatHostProperties.mentionBackground]: tokens.surface.tone.info.background,
  [chatHostProperties.mentionForeground]: tokens.surface.tone.info.foreground,
  [chatHostProperties.codeBackground]: tokens.surface.level.sunken.background,
  [chatHostProperties.inlineCodeBackground]: tokens.surface.level.sunken.hover,
  [chatHostProperties.tableHeaderBackground]: tokens.surface.level.raised.background,
  [chatHostProperties.planDone]: tokens.feedback.success.foreground,
  [chatHostProperties.planActive]: tokens.feedback.warning.foreground,
  [chatHostProperties.fontSans]: tokens.typography.family.sans,
  [chatHostProperties.fontMono]: tokens.typography.family.mono,
  [chatHostProperties.radiusSmall]: tokens.radius.sm,
  [chatHostProperties.radiusMedium]: tokens.radius.md,
  [chatHostProperties.radiusLarge]: tokens.radius.lg,
  [chatHostProperties.radiusExtraLarge]: tokens.radius.xl,
  [chatHostProperties.radiusFull]: tokens.radius.full,
} satisfies Readonly<Record<ChatHostProperty, TokenReference>>;

/** Storybook is a separate host and supplies its own Chat UI property map. */
export const storybookChatHostAdapterClassName = hostAdapter({
  root: {
    vars: storybookChatHostTokenValues,
  },
  descendants: {},
});
