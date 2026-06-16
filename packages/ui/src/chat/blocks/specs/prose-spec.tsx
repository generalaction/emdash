/**
 * prose-spec — colocated measure + render for ProseBlock.
 *
 * Measure: pretext rich-inline line count × lineHeight (variant-specific).
 * Render: semantic HTML elements (<p>, <h*>, <ul>/<li>, <blockquote>).
 *
 * Both use the same font/lineHeight constants from FontConfig, which is itself
 * derived from metrics.ts. No drift possible.
 */

import { measureRichInlineStats, type RichInlineItem } from '@chenglou/pretext/rich-inline';
import React from 'react';
import type { FontConfig } from '../../measure/fonts';
import { getPreparedRichInline } from '../../measure/pretext-cache';
import type { ChatSlots } from '../../view/chat-transcript';
import type { BlockMeasureCtx, BlockRenderCtx, BlockSpec } from '../block-spec';
import type { InlineCode, InlineMention, InlineRun, InlineText, ProseBlock } from '../block-types';

// ── Inline runs → RichInlineItem[] ──────────────────────────────────────────

function runsToRichItems(runs: InlineRun[], fonts: FontConfig): RichInlineItem[] {
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

// ── Measure ──────────────────────────────────────────────────────────────────

function measureProse(block: ProseBlock, ctx: BlockMeasureCtx): number {
  if (ctx.collapsed) return 0;
  const { fonts, width } = ctx;

  const items = runsToRichItems(block.runs, fonts);
  if (items.length === 0) return 0;

  let lineHeight: number;
  switch (block.variant) {
    case 'h1':
      lineHeight = fonts.h1.lineHeight;
      break;
    case 'h2':
      lineHeight = fonts.h2.lineHeight;
      break;
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      lineHeight = fonts.h3.lineHeight;
      break;
    default:
      lineHeight = fonts.body.lineHeight;
  }

  // Reduce available width by the indent (list items, blockquotes).
  const depth = block.depth ?? 0;
  const indent =
    block.variant === 'list-item' || block.variant === 'quote' ? (depth + 1) * fonts.listIndent : 0;
  const effectiveWidth = Math.max(1, width - indent);

  const prepared = getPreparedRichInline(items);
  const stats = measureRichInlineStats(prepared, effectiveWidth);
  return stats.lineCount * lineHeight;
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderRun(run: InlineRun, index: number, slots?: ChatSlots): React.ReactNode {
  if (run.kind === 'mention') {
    const m = run as InlineMention;
    if (slots?.renderMention) {
      return <React.Fragment key={index}>{slots.renderMention(m.label, m.tone)}</React.Fragment>;
    }
    return (
      <span key={index} className="chat-mention" data-tone={m.tone}>
        {m.label}
      </span>
    );
  }
  if (run.kind === 'code') {
    return (
      <code key={index} className="chat-code-inline">
        {(run as InlineCode).text}
      </code>
    );
  }
  const t = run as InlineText;
  let el: React.ReactNode = t.text;
  if (t.bold && t.italic)
    el = (
      <strong>
        <em>{el}</em>
      </strong>
    );
  else if (t.bold) el = <strong>{el}</strong>;
  else if (t.italic) el = <em>{el}</em>;
  if (t.strike) el = <del>{el}</del>;
  if (t.href)
    el = (
      <a href={t.href} target="_blank" rel="noopener noreferrer">
        {el}
      </a>
    );
  return <React.Fragment key={index}>{el}</React.Fragment>;
}

function renderInlines(runs: InlineRun[], slots?: ChatSlots): React.ReactNode {
  return runs.map((run, i) => renderRun(run, i, slots));
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderProse(block: ProseBlock, ctx: BlockRenderCtx): React.ReactNode {
  if (ctx.collapsed) return null;
  const { slots } = ctx;
  const content = renderInlines(block.runs, slots);
  const depth = block.depth ?? 0;

  switch (block.variant) {
    case 'h1':
      return <h1 className="chat-h1">{content}</h1>;
    case 'h2':
      return <h2 className="chat-h2">{content}</h2>;
    case 'h3':
      return <h3 className="chat-h3">{content}</h3>;
    case 'h4':
      return <h4 className="chat-h4">{content}</h4>;
    case 'h5':
      return <h5 className="chat-h5">{content}</h5>;
    case 'h6':
      return <h6 className="chat-h6">{content}</h6>;
    case 'list-item':
      return (
        <ul
          className="chat-list"
          style={{ paddingLeft: `calc(var(--chat-list-indent) * ${depth + 1})` }}
        >
          <li className="chat-list-item">{content}</li>
        </ul>
      );
    case 'quote':
      return (
        <blockquote
          className="chat-quote"
          style={{ paddingLeft: `calc(var(--chat-quote-indent) * ${depth + 1})` }}
        >
          {content}
        </blockquote>
      );
    default:
      return <p className="chat-p">{content}</p>;
  }
}

// ── Export spec ───────────────────────────────────────────────────────────────

export const proseSpec: BlockSpec<ProseBlock> = {
  measure: measureProse,
  render: renderProse,
};
