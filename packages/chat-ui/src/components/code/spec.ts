/**
 * codeSpec — BlockSpec for CodeBlock / CodeLaidOut.
 *
 * Owns the geometry constants, CSS variable emission, and pure layout function
 * for code blocks. Changing a value in `metrics` automatically propagates to
 * both the layout height and the `var(--chat-code-*)` CSS custom properties.
 */

import type { CodeBlock } from '../../core/blocks/block-types';
import type { FontConfig } from '../../core/measure/fonts';
import { CODE_BLOCK, CODE_LANG } from '../../core/metrics';
import type { BlockSpec } from '../../core/layout/spec-types';
import type { CodeLaidOut } from '../../core/layout/layout-types';
import { layoutCode } from './layout';
import { CODE_BLOCK_PAD_X, CODE_BLOCK_PAD_Y, CODE_BLOCK_BORDER } from './metrics';

export const codeSpec: BlockSpec<CodeBlock, CodeLaidOut> = {
  metrics: {
    padY: CODE_BLOCK_PAD_Y,
    padX: CODE_BLOCK_PAD_X,
    border: CODE_BLOCK_BORDER,
  },

  cssVars() {
    return {
      '--chat-code-pad-y': `${CODE_BLOCK_PAD_Y}px`,
      '--chat-code-pad-x': `${CODE_BLOCK_PAD_X}px`,
      '--chat-code-border': `${CODE_BLOCK_BORDER}px`,
      '--chat-code-size': `${CODE_BLOCK.fontSize}px`,
      '--chat-code-weight': `${CODE_BLOCK.fontWeight}`,
      '--chat-code-lh': `${CODE_BLOCK.lineHeight}px`,
      '--chat-lang-size': `${CODE_LANG.fontSize}px`,
      '--chat-lang-weight': `${CODE_LANG.fontWeight}`,
      '--chat-lang-lh': `${CODE_LANG.lineHeight}px`,
    };
  },

  layout(block: CodeBlock, fonts: FontConfig, top: number, width: number): CodeLaidOut {
    return layoutCode(block, fonts, top, width);
  },
};
