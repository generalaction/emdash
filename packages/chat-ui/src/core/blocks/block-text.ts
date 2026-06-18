/**
 * blockPlainText — extract a plain-text string from a Block.
 *
 * Used for a11y mirrors (sr-only) in message rows. Each block tier produces a
 * human-readable string without any markdown syntax or HTML.
 */

import type { Block, InlineRun, ProseBlock } from './block-types';

function inlineRunText(run: InlineRun): string {
  if (run.kind === 'text') return run.text;
  if (run.kind === 'code') return run.text;
  if (run.kind === 'mention') return run.label;
  return ''; // break
}

export function blockPlainText(block: Block): string {
  if (block.tier === 'prose') {
    return (block as ProseBlock).runs.map(inlineRunText).join('');
  }
  if (block.tier === 'code') return block.code;
  if (block.tier === 'table') {
    const allRows = [block.header, ...block.rows];
    return allRows.map((row) => row.join(' | ')).join('\n');
  }
  return '';
}
