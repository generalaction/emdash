/**
 * proseSpec — BlockSpec for ProseBlock / ProseLaidOut.
 *
 * Prose geometry is entirely driven by typography (FontConfig) and the shared
 * indent constants in core/metrics.  There are no per-block-kind padding or
 * border metrics beyond what comes from fonts, so `metrics` is empty and
 * `cssVars()` emits only the typography variables that prose CSS reads.
 */

import type { ProseBlock } from '../../core/blocks/block-types';
import type { FontConfig } from '../../core/measure/fonts';
import {
  BODY,
  BLOCKQUOTE_INDENT,
  H1,
  H2,
  H3,
  INLINE_CODE,
  LIST_INDENT,
} from '../../core/metrics';
import type { BlockSpec } from '../../core/layout/spec-types';
import type { ProseLaidOut } from '../../core/layout/layout-types';
import { layoutProse } from './layout';

export const proseSpec: BlockSpec<ProseBlock, ProseLaidOut> = {
  metrics: {},

  cssVars() {
    return {
      '--chat-body-size': `${BODY.fontSize}px`,
      '--chat-body-weight': `${BODY.fontWeight}`,
      '--chat-body-lh': `${BODY.lineHeight}px`,
      '--chat-h1-size': `${H1.fontSize}px`,
      '--chat-h1-weight': `${H1.fontWeight}`,
      '--chat-h1-lh': `${H1.lineHeight}px`,
      '--chat-h2-size': `${H2.fontSize}px`,
      '--chat-h2-weight': `${H2.fontWeight}`,
      '--chat-h2-lh': `${H2.lineHeight}px`,
      '--chat-h3-size': `${H3.fontSize}px`,
      '--chat-h3-weight': `${H3.fontWeight}`,
      '--chat-h3-lh': `${H3.lineHeight}px`,
      '--chat-ic-size': `${INLINE_CODE.fontSize}px`,
      '--chat-ic-weight': `${INLINE_CODE.fontWeight}`,
      '--chat-ic-pad-x': '6px',
      '--chat-ic-pad-y': '2px',
      '--chat-list-indent': `${LIST_INDENT}px`,
      '--chat-quote-indent': `${BLOCKQUOTE_INDENT}px`,
    };
  },

  layout(block: ProseBlock, fonts: FontConfig, top: number, width: number): ProseLaidOut {
    return layoutProse(block, width, fonts, top);
  },
};
