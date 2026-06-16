/**
 * FontConfig — pretext measurement configuration.
 *
 * Contains only typography variants (font shorthand + line-height pairs) and
 * the shared indent/sizing constants needed by pretext shaping.
 *
 * Component-private geometry constants (bubble padding, block gap, code block
 * padding, thinking heights, etc.) have been moved to each component's
 * metrics.ts file and are no longer part of FontConfig.  That makes FontConfig
 * a stable, small interface that changes only when typography changes.
 */

import {
  BLOCKQUOTE_INDENT,
  BODY_BOLD_FONT,
  BODY_BOLD_ITALIC_FONT,
  BODY_FONT,
  BODY_ITALIC_FONT,
  BODY_LINK_FONT,
  BODY,
  CODE_BLOCK_FONT,
  CODE_BLOCK,
  H1_FONT,
  H1,
  H2_FONT,
  H2,
  H3_FONT,
  H3,
  INLINE_CODE_EXTRA_WIDTH,
  INLINE_CODE_FONT,
  INLINE_CODE,
  LIST_INDENT,
  MENTION_EXTRA_WIDTH,
  MENTION_FONT,
  MENTION,
} from '../metrics';

export type VariantMetrics = {
  font: string;
  lineHeight: number;
};

export type FontConfig = {
  body: VariantMetrics;
  bold: VariantMetrics;
  italic: VariantMetrics;
  boldItalic: VariantMetrics;
  link: VariantMetrics;
  h1: VariantMetrics;
  h2: VariantMetrics;
  h3: VariantMetrics;
  inlineCode: VariantMetrics;
  mention: VariantMetrics;
  code: VariantMetrics;
  /** Shared indent/sizing used by pretext shaping (not by component renderers). */
  inlineCodeExtraWidth: number;
  mentionExtraWidth: number;
  listIndent: number;
  blockquoteIndent: number;
};

export const DEFAULT_FONT_CONFIG: FontConfig = {
  body: { font: BODY_FONT, lineHeight: BODY.lineHeight },
  bold: { font: BODY_BOLD_FONT, lineHeight: BODY.lineHeight },
  italic: { font: BODY_ITALIC_FONT, lineHeight: BODY.lineHeight },
  boldItalic: { font: BODY_BOLD_ITALIC_FONT, lineHeight: BODY.lineHeight },
  link: { font: BODY_LINK_FONT, lineHeight: BODY.lineHeight },
  h1: { font: H1_FONT, lineHeight: H1.lineHeight },
  h2: { font: H2_FONT, lineHeight: H2.lineHeight },
  h3: { font: H3_FONT, lineHeight: H3.lineHeight },
  inlineCode: { font: INLINE_CODE_FONT, lineHeight: INLINE_CODE.lineHeight },
  mention: { font: MENTION_FONT, lineHeight: MENTION.lineHeight },
  code: { font: CODE_BLOCK_FONT, lineHeight: CODE_BLOCK.lineHeight },
  inlineCodeExtraWidth: INLINE_CODE_EXTRA_WIDTH,
  mentionExtraWidth: MENTION_EXTRA_WIDTH,
  listIndent: LIST_INDENT,
  blockquoteIndent: BLOCKQUOTE_INDENT,
};
