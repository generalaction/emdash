/**
 * render-prose — imperative DOM rendering for ProseLaidOut.
 *
 * Returns the root .pblock element (caller appends it to the bubble).
 */

import type { InlineRun } from '../blocks/block-types';
import type { BulletLayout, FragmentLayout, LineLayout, ProseLaidOut } from '../layout/layout-types';
import type { ChatSlots } from '../slots';
import { el } from './dom-utils';
import style from './render-prose.module.css';

// ── Fragment class mapping ────────────────────────────────────────────────────

function fragKey(run: InlineRun, baseVariant: string): string {
  if (
    baseVariant === 'h1' ||
    baseVariant === 'h2' ||
    baseVariant === 'h3' ||
    baseVariant === 'h4' ||
    baseVariant === 'h5' ||
    baseVariant === 'h6'
  ) {
    return `pf--${baseVariant}`;
  }
  if (run.kind === 'code') return 'pf--inline-code';
  if (run.kind === 'mention') return 'pf--mention';
  if (run.kind === 'text') {
    if (run.bold && run.italic) return 'pf--bold-italic';
    if (run.bold) return 'pf--bold';
    if (run.italic) return 'pf--italic';
    if (run.href) return 'pf--link';
  }
  return 'pf--body';
}

// ── Sub-element builders ──────────────────────────────────────────────────────

function ProseQuoteRail(left: number): HTMLElement {
  return el('div', {
    className: style['pquote-rail'],
    style: { left: `${left}px` },
  });
}

function ProseBullet(bullet: BulletLayout): HTMLElement {
  return el('span', {
    className: style['pbullet'],
    style: {
      left: `${bullet.x}px`,
      top: `${bullet.top}px`,
    },
    attrs: { 'aria-hidden': 'true' },
    children: [bullet.char],
  });
}

function ProseFragment(
  run: InlineRun,
  frag: FragmentLayout,
  variant: string,
  slots?: ChatSlots
): Node {
  // Mention: slot override
  if (run.kind === 'mention' && slots?.renderMention) {
    const wrapper = el('span', {
      className: `${style['pf']} ${style['pf--mention']}`,
      style: { left: `${frag.x}px` },
    });
    wrapper.appendChild(slots.renderMention(run.label, run.tone));
    return wrapper;
  }

  const key = fragKey(run, variant);
  const fragCls = `${style['pf']} ${style[key]}`;

  if (run.kind === 'text' && run.href) {
    return el('a', {
      className: fragCls,
      style: { left: `${frag.x}px` },
      attrs: {
        href: run.href,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      children: [frag.text],
    });
  }

  return el('span', {
    className: fragCls,
    style: { left: `${frag.x}px` },
    children: [frag.text],
  });
}

function ProseLine(
  line: LineLayout,
  lineHeight: number,
  runs: InlineRun[],
  variant: string,
  slots?: ChatSlots
): HTMLElement {
  const lineEl = el('div', {
    className: style['pline'],
    style: {
      top: `${line.top}px`,
      left: `${line.left}px`,
      // Explicit band height so `.pf { top: 50% }` centers text within the
      // line, not on its top edge (which left a phantom half-line gap).
      height: `${lineHeight}px`,
    },
  });

  for (const frag of line.fragments) {
    const run = runs[frag.runIndex];
    if (!run) continue;
    lineEl.appendChild(ProseFragment(run, frag, variant, slots));
  }

  return lineEl;
}

// ── Main render function ──────────────────────────────────────────────────────

export function renderProse(
  block: ProseLaidOut,
  runs: InlineRun[],
  variant: string,
  slots?: ChatSlots
): HTMLElement {
  const wrapper = el('div', {
    className: style['pblock'],
    style: {
      top: `${block.top}px`,
      height: `${block.height}px`,
      width: '100%',
    },
  });

  if (block.quoteRail) {
    wrapper.appendChild(ProseQuoteRail((block.lines[0]?.left ?? 18) - 10));
  }

  if (block.bullet) {
    wrapper.appendChild(ProseBullet(block.bullet));
  }

  for (const line of block.lines) {
    wrapper.appendChild(ProseLine(line, block.lineHeight, runs, variant, slots));
  }

  return wrapper;
}
