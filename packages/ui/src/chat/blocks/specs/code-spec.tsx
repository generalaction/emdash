/**
 * code-spec — colocated measure + render for CodeBlock.
 *
 * Measure: lines × CODE_LINE_HEIGHT + 2 × padY + 2 × borderWidth + (lang label if present).
 * Render:  .chat-code-block with optional .chat-code-lang label + <pre>.
 *
 * The lang-label height was previously ignored in HeightModel — fixed here.
 */

import React from 'react';
import type { BlockMeasureCtx, BlockRenderCtx, BlockSpec } from '../block-spec';
import type { CodeBlock } from '../block-types';

// ── Measure ──────────────────────────────────────────────────────────────────

function measureCode(block: CodeBlock, ctx: BlockMeasureCtx): number {
  if (ctx.collapsed) return 0;
  const { fonts } = ctx;

  const codeLines = block.code.split('\n').length;
  const codeHeight = codeLines * fonts.code.lineHeight;

  // Lang label: one line of code-lang font + 6px margin-bottom (defined in chat.css).
  const LANG_LABEL_MARGIN = 6;
  const langHeight = block.lang ? fonts.codeLang.lineHeight + LANG_LABEL_MARGIN : 0;

  // 2 × padY + 2 × border
  const chrome = 2 * fonts.codeBlockPadY + 2 * fonts.codeBlockBorder;

  return langHeight + codeHeight + chrome;
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderCode(block: CodeBlock, ctx: BlockRenderCtx): React.ReactNode {
  if (ctx.collapsed) return null;

  // Lightweight placeholder during active scroll — avoids mounting a large <pre>
  // subtree on every frame.  The div has the same chrome classes as the real block
  // so height is preserved (CSS padding/border apply identically).
  if (ctx.isScrolling) {
    return <div className="chat-code-block chat-code-block--placeholder" aria-hidden="true" />;
  }

  if (ctx.slots?.renderCode) {
    return <>{ctx.slots.renderCode(block)}</>;
  }

  return (
    <div className="chat-code-block">
      {block.lang && (
        <div className="chat-code-lang" aria-label={`Language: ${block.lang}`}>
          {block.lang}
        </div>
      )}
      <pre>
        <code>{block.code}</code>
      </pre>
    </div>
  );
}

// ── Export spec ───────────────────────────────────────────────────────────────

export const codeSpec: BlockSpec<CodeBlock> = {
  measure: measureCode,
  render: renderCode,
};
