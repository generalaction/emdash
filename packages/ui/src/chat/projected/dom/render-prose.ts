/**
 * render-prose — imperative DOM rendering for ProseLaidOut.
 *
 * Ports ProjectedProseBlock to document.createElement. No React.
 * Returns the root .pblock element (caller appends it to the bubble).
 */

import type { InlineRun } from '../../blocks/block-types';
import type { ProseLaidOut } from '../layout/layout-types';
import type { ImperativeSlots } from '../slots';
import { el } from './dom-utils';
import style from '../projected.module.css';

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

// ── Main render function ──────────────────────────────────────────────────────

export function renderProse(
  block: ProseLaidOut,
  runs: InlineRun[],
  variant: string,
  slots?: ImperativeSlots
): HTMLElement {
  const wrapper = el('div', {
    className: style['pblock'],
    style: {
      top: `${block.top}px`,
      height: `${block.height}px`,
      width: '100%',
    },
  });

  // Quote rail
  if (block.quoteRail) {
    const rail = el('div', {
      className: style['pquote-rail'],
      style: { left: `${(block.lines[0]?.left ?? 18) - 10}px` },
    });
    wrapper.appendChild(rail);
  }

  // Bullet
  if (block.bullet) {
    const bullet = el('span', {
      className: style['pbullet'],
      style: {
        left: `${block.bullet.x}px`,
        top: `${block.bullet.top}px`,
      },
      attrs: { 'aria-hidden': 'true' },
      children: [block.bullet.char],
    });
    wrapper.appendChild(bullet);
  }

  // Lines
  for (const line of block.lines) {
    const lineEl = el('div', {
      className: style['pline'],
      style: {
        top: `${line.top}px`,
        left: `${line.left}px`,
        // Explicit band height so `.pf { top: 50% }` centers text within the
        // line, not on its top edge (which left a phantom half-line gap).
        height: `${block.lineHeight}px`,
      },
    });

    for (const frag of line.fragments) {
      const run = runs[frag.runIndex];
      if (!run) continue;

      // Mention: slot override
      if (run.kind === 'mention' && slots?.renderMention) {
        const mentionWrapper = el('span', {
          className: `${style['pf']} ${style['pf--mention']}`,
          style: { left: `${frag.x}px` },
        });
        mentionWrapper.appendChild(slots.renderMention(run.label, run.tone));
        lineEl.appendChild(mentionWrapper);
        continue;
      }

      const key = fragKey(run, variant);
      const fragCls = `${style['pf']} ${style[key]}`;

      if (run.kind === 'text' && run.href) {
        const a = el('a', {
          className: fragCls,
          style: { left: `${frag.x}px` },
          attrs: {
            href: run.href,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          children: [frag.text],
        });
        lineEl.appendChild(a);
      } else {
        const span = el('span', {
          className: fragCls,
          style: { left: `${frag.x}px` },
          children: [frag.text],
        });
        lineEl.appendChild(span);
      }
    }

    wrapper.appendChild(lineEl);
  }

  return wrapper;
}
