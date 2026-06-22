/**
 * to-rich-items — Convert InlineRun[] to the RichInlineItem[] format that pretext expects.
 *
 * Bridges the markdown document model (InlineRun) and the measurement tier
 * (pretext / FontConfig). Lives in core/measure/ because it depends on both
 * pretext and FontConfig — keeping it out of core/markdown/ preserves that
 * module as a pure, dependency-free document model.
 *
 * Mention icon geometry (mentionIconW, mentionIconGap) is now read from the
 * FontConfig passed in so there is no import-time coupling to the Prose renderer.
 */

import type { RichInlineItem } from '@chenglou/pretext/rich-inline';
import type { InlineCode, InlineMention, InlineRun, InlineText } from '@core/markdown/document';
import type { FontConfig } from '@core/config';

export function runsToRichItems(runs: InlineRun[], fonts: FontConfig): RichInlineItem[] {
  return runs.flatMap((run): RichInlineItem[] => {
    // Break markers are segment boundaries in layoutProse; they have no glyph.
    if (run.kind === 'break') return [];
    if (run.kind === 'code') {
      return [
        {
          text: (run as InlineCode).text,
          font: fonts.inlineCode.font,
          break: 'never',
          extraWidth: fonts.inlineCodeExtraWidth,
        },
      ];
    }
    if (run.kind === 'mention') {
      const mention = run as InlineMention;
      // Resolved mentions display the short name and include extra space for the
      // leading icon container. fonts.mentionIconW + fonts.mentionIconGap must equal
      // the px values used in Prose.tsx so rendering and measurement stay in sync.
      const displayText = mention.name ?? mention.label;
      const iconWidth = mention.mentionKind ? fonts.mentionIconW + fonts.mentionIconGap : 0;
      return [
        {
          text: displayText,
          font: fonts.mention.font,
          break: 'never',
          extraWidth: fonts.mentionExtraWidth + iconWidth,
        },
      ];
    }
    const t = run as InlineText;
    let font = fonts.body.font;
    if (t.bold && t.italic) font = fonts.boldItalic.font;
    else if (t.bold) font = fonts.bold.font;
    else if (t.italic) font = fonts.italic.font;
    else if (t.href) font = fonts.link.font;
    return [{ text: t.text, font }];
  });
}
