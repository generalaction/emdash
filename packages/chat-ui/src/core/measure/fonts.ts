import {
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
  inlineCodeExtraWidth: number;
  mentionExtraWidth: number;
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
};
