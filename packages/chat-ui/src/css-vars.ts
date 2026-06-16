/**
 * chatCssVars — single source of all --chat-* CSS custom properties.
 *
 * Assembled from each component spec's cssVars() function plus shared
 * typography constants.  ChatRoot writes these on the transcript root element
 * so every var(--chat-*) resolves consistently across all renderers.
 *
 * To change any visual constant: edit the relevant component's metrics.ts.
 * The change will propagate here (CSS vars) and to the layout arithmetic
 * (geometry) automatically.
 */

import {
  BODY,
  BODY_BOLD,
  BODY_LINK,
  H1,
  H2,
  H3,
  INLINE_CODE,
  MENTION,
  MENTION_EXTRA_WIDTH,
  ROW_GAP,
  ROW_INSET_X,
  SANS_FAMILY,
  MONO_FAMILY,
} from './core/metrics';
import { codeSpec } from './components/code/spec';
import { proseSpec } from './components/prose/spec';
import { islandSpec } from './components/island/spec';
import { messageCssVars } from './components/message/css-vars';
import { toolCssVars } from './components/tool/spec';
import { thinkingCssVars } from './components/thinking/spec';

function typographyCssVars(): Record<string, string> {
  return {
    '--chat-sans': `var(--typography-font-family-sans, ${SANS_FAMILY})`,
    '--chat-mono': `var(--typography-font-family-mono, ${MONO_FAMILY})`,

    '--chat-body-size': `var(--typography-body-size, ${BODY.fontSize}px)`,
    '--chat-body-weight': `var(--typography-body-weight, ${BODY.fontWeight})`,
    '--chat-body-lh': `var(--typography-body-line-height, ${BODY.lineHeight}px)`,
    '--chat-body-bold-weight': `var(--typography-body-bold-weight, ${BODY_BOLD.fontWeight})`,
    '--chat-body-link-weight': `var(--typography-body-link-weight, ${BODY_LINK.fontWeight})`,

    '--chat-h1-size': `var(--typography-h1-size, ${H1.fontSize}px)`,
    '--chat-h1-weight': `var(--typography-h1-weight, ${H1.fontWeight})`,
    '--chat-h1-lh': `var(--typography-h1-line-height, ${H1.lineHeight}px)`,
    '--chat-h2-size': `var(--typography-h2-size, ${H2.fontSize}px)`,
    '--chat-h2-weight': `var(--typography-h2-weight, ${H2.fontWeight})`,
    '--chat-h2-lh': `var(--typography-h2-line-height, ${H2.lineHeight}px)`,
    '--chat-h3-size': `var(--typography-h3-size, ${H3.fontSize}px)`,
    '--chat-h3-weight': `var(--typography-h3-weight, ${H3.fontWeight})`,
    '--chat-h3-lh': `var(--typography-h3-line-height, ${H3.lineHeight}px)`,

    '--chat-ic-size': `var(--typography-inline-code-size, ${INLINE_CODE.fontSize}px)`,
    '--chat-ic-weight': `var(--typography-inline-code-weight, ${INLINE_CODE.fontWeight})`,
    '--chat-ic-pad-x': '6px',
    '--chat-ic-pad-y': '2px',

    '--chat-mention-size': `var(--typography-mention-size, ${MENTION.fontSize}px)`,
    '--chat-mention-weight': `var(--typography-mention-weight, ${MENTION.fontWeight})`,
    '--chat-mention-pad-x': `${MENTION_EXTRA_WIDTH / 2}px`,

    '--chat-row-gap': `${ROW_GAP}px`,
    '--chat-msg-pad-x': `${ROW_INSET_X}px`,
  };
}

export function chatCssVars(): Record<string, string> {
  return {
    ...typographyCssVars(),
    ...proseSpec.cssVars(),
    ...codeSpec.cssVars(),
    ...islandSpec.cssVars(),
    ...messageCssVars(),
    ...toolCssVars(),
    ...thinkingCssVars(),
  };
}
