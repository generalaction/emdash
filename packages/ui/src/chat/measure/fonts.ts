/**
 * FontConfig — pretext measurement configuration, derived entirely from metrics.ts.
 *
 * This file is the bridge between the single-source metrics and the pretext API.
 * Do NOT define raw numeric constants here; import them from metrics.ts instead.
 * That way HeightModel and chat.css (via CSS variables) always agree.
 */

import {
  BLOCK_GAP,
  BLOCKQUOTE_INDENT,
  BODY_BOLD_FONT,
  BODY_BOLD_ITALIC_FONT,
  BODY_FONT,
  BODY_ITALIC_FONT,
  BODY_LINK_FONT,
  BODY,
  BUBBLE_PAD_Y,
  CODE_BLOCK_BORDER,
  CODE_BLOCK_FONT,
  CODE_BLOCK_PAD_X,
  CODE_BLOCK_PAD_Y,
  CODE_LANG,
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
  ISLAND_FIXED_HEIGHT,
  LIST_INDENT,
  MENTION_EXTRA_WIDTH,
  MENTION_FONT,
  MENTION,
} from '../metrics';

export type VariantMetrics = {
  /** CSS font shorthand, exactly matching the computed font of the rendered element. */
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
  codeLang: VariantMetrics;
  blockGap: number;
  bubblePadY: number;
  codeBlockPadX: number;
  codeBlockPadY: number;
  codeBlockBorder: number;
  inlineCodeExtraWidth: number;
  mentionExtraWidth: number;
  listIndent: number;
  blockquoteIndent: number;
  islandFixedHeight: number;
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
  codeLang: { font: CODE_BLOCK_FONT, lineHeight: CODE_LANG.lineHeight },
  blockGap: BLOCK_GAP,
  bubblePadY: BUBBLE_PAD_Y,
  codeBlockPadX: CODE_BLOCK_PAD_X,
  codeBlockPadY: CODE_BLOCK_PAD_Y,
  codeBlockBorder: CODE_BLOCK_BORDER,
  inlineCodeExtraWidth: INLINE_CODE_EXTRA_WIDTH,
  mentionExtraWidth: MENTION_EXTRA_WIDTH,
  listIndent: LIST_INDENT,
  blockquoteIndent: BLOCKQUOTE_INDENT,
  islandFixedHeight: ISLAND_FIXED_HEIGHT,
};
