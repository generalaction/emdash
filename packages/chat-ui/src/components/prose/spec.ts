/**
 * proseSpec — BlockSpec for ProseBlock / ProseLaidOut.
 *
 * Prose geometry is entirely driven by typography (FontConfig) and the shared
 * indent constants in core/metrics.  There are no per-block-kind padding or
 * border metrics beyond what comes from fonts, so `metrics` is empty and
 * `cssVars()` emits only the chat-specific padding/indent values that prose
 * CSS reads. Typography (size, weight, family) is now sourced directly from
 * @emdash/ui --type-* role tokens in prose.module.css — no re-emission needed.
 */

import type { ProseBlock } from '../../core/blocks/block-types';
import type { ProseLaidOut } from '../../core/layout/layout-types';
import type { BlockSpec } from '../../core/layout/spec-types';
import type { FontConfig } from '../../core/measure/fonts';
import { BLOCKQUOTE_INDENT, INLINE_CODE, LIST_INDENT } from '../../core/metrics';
import { layoutProse } from './layout';

export const proseSpec: BlockSpec<ProseBlock, ProseLaidOut> = {
  metrics: {},

  cssVars() {
    return {
      '--chat-ic-pad-x': '6px',
      '--chat-ic-pad-y': '2px',
      '--chat-ic-extra-w': `${INLINE_CODE.fontSize}px`,
      '--chat-list-indent': `${LIST_INDENT}px`,
      '--chat-quote-indent': `${BLOCKQUOTE_INDENT}px`,
    };
  },

  layout(block: ProseBlock, fonts: FontConfig, top: number, width: number): ProseLaidOut {
    return layoutProse(block, width, fonts, top);
  },
};
