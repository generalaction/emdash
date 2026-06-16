/**
 * Convert InlineRun[] to the RichInlineItem[] format that pretext expects.
 *
 * This is an owned copy of the mapping in prose-spec.tsx, kept here so the
 * projected engine is fully self-contained and can evolve independently.
 */

import type { RichInlineItem } from '@chenglou/pretext/rich-inline';
import type { InlineCode, InlineMention, InlineRun, InlineText } from '../../blocks/block-types';
import type { FontConfig } from '../../measure/fonts';

export function runsToRichItems(runs: InlineRun[], fonts: FontConfig): RichInlineItem[] {
  return runs.map((run): RichInlineItem => {
    if (run.kind === 'code') {
      return {
        text: (run as InlineCode).text,
        font: fonts.inlineCode.font,
        break: 'never',
        extraWidth: fonts.inlineCodeExtraWidth,
      };
    }
    if (run.kind === 'mention') {
      return {
        text: (run as InlineMention).label,
        font: fonts.mention.font,
        break: 'never',
        extraWidth: fonts.mentionExtraWidth,
      };
    }
    const t = run as InlineText;
    let font = fonts.body.font;
    if (t.bold && t.italic) font = fonts.boldItalic.font;
    else if (t.bold) font = fonts.bold.font;
    else if (t.italic) font = fonts.italic.font;
    else if (t.href) font = fonts.link.font;
    return { text: t.text, font };
  });
}
