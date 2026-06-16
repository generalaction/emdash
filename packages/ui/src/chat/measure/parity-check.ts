/**
 * Measure/render parity checker.
 *
 * Renders representative blocks into a detached DOM element and compares the
 * observed pixel height against the value produced by `specForBlock().measure()`.
 * A mismatch indicates that fonts.ts constants or block-spec chrome accounting
 * has drifted from what the browser actually renders.
 *
 * Call `runParityCheck()` during Storybook development or from tests after
 * fonts have loaded. It is development-only and should not run in hot paths.
 */

import { specForBlock } from '../blocks/block-spec';
import type { Block } from '../blocks/block-types';
import { DEFAULT_FONT_CONFIG } from './fonts';
import type { FontConfig } from './fonts';

export type ParityResult = {
  label: string;
  predictedPx: number;
  renderedPx: number;
  ok: boolean;
  driftPx: number;
};

// ── Representative blocks to check ───────────────────────────────────────────

function makeSampleBlocks(): Block[] {
  return [
    // Short prose paragraph
    {
      kind: 'prose',
      tier: 'prose',
      id: 'par-1',
      variant: 'body',
      runs: [{ kind: 'text', text: 'Hello world — a short prose paragraph.' }],
    },
    // Prose paragraph long enough to wrap at typical widths
    {
      kind: 'prose',
      tier: 'prose',
      id: 'par-2',
      variant: 'body',
      runs: [
        {
          kind: 'text',
          text: 'A much longer sentence that should wrap onto a second line when the container is narrow enough to force a break in the middle of the text.',
        },
      ],
    },
    // H1 heading
    {
      kind: 'prose',
      tier: 'prose',
      id: 'h1-1',
      variant: 'h1',
      runs: [{ kind: 'text', text: 'Large Heading Level One', bold: true }],
    },
    // H2 heading
    {
      kind: 'prose',
      tier: 'prose',
      id: 'h2-1',
      variant: 'h2',
      runs: [{ kind: 'text', text: 'Medium Heading Level Two', bold: true }],
    },
    // H3 heading
    {
      kind: 'prose',
      tier: 'prose',
      id: 'h3-1',
      variant: 'h3',
      runs: [{ kind: 'text', text: 'Small heading level three', bold: true }],
    },
    // List item
    {
      kind: 'prose',
      tier: 'prose',
      id: 'li-1',
      variant: 'list-item',
      runs: [{ kind: 'text', text: 'A list item with some text' }],
      depth: 0,
    },
    // Code block without lang
    {
      kind: 'code',
      tier: 'code',
      id: 'code-1',
      code: 'const x = 1;\nconst y = 2;\nreturn x + y;',
      lang: undefined,
    },
    // Code block WITH lang label (this is where the old model drifted)
    {
      kind: 'code',
      tier: 'code',
      id: 'code-2',
      code: 'function add(a: number, b: number): number {\n  return a + b;\n}',
      lang: 'typescript',
    },
  ];
}

// ── CSS needed to replicate the render environment ───────────────────────────

function buildCssText(fonts: FontConfig): string {
  return `
    font-family: ${fonts.body.font.replace(/^\d+\s+\d+px\s+/, '')};
    font-size: ${fonts.body.font.match(/\d+px/)?.[0] ?? '14px'};
    line-height: ${fonts.body.lineHeight}px;
    box-sizing: border-box;
  `;
}

// ── Main check ───────────────────────────────────────────────────────────────

/**
 * Render each sample block into a detached off-screen element, measure the
 * actual height, and compare against `spec.measure()`.
 *
 * @param containerWidth - content width in px to use for both measure and DOM
 * @param fonts - FontConfig (defaults to DEFAULT_FONT_CONFIG)
 */
export function runParityCheck(
  containerWidth: number,
  fonts: FontConfig = DEFAULT_FONT_CONFIG
): ParityResult[] {
  const blocks = makeSampleBlocks();
  const results: ParityResult[] = [];

  // Outer container matches a minimal .chat-bubble environment
  const outer = document.createElement('div');
  outer.style.cssText = [
    `width: ${containerWidth}px`,
    'position: absolute',
    'visibility: hidden',
    'top: -9999px',
    'left: -9999px',
    'box-sizing: border-box',
    buildCssText(fonts),
  ].join(';');
  document.body.appendChild(outer);

  for (const block of blocks) {
    const predictedPx = specForBlock(block).measure(block, {
      width: containerWidth,
      fonts,
      collapsed: false,
    });

    // Render the block label as a string for the report
    const label =
      block.tier === 'code'
        ? `code[lang=${block.kind === 'code' && block.lang ? block.lang : 'none'}]`
        : block.tier === 'prose'
          ? `prose[${block.variant}]`
          : `island[${block.tier}]`;

    // We can only DOM-measure prose and code blocks here; islands need async render
    if (block.tier === 'island') continue;

    // Build a DOM representation matching what the spec renders
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;box-sizing:border-box;';

    if (block.tier === 'prose') {
      el.style.fontFamily = (() => {
        switch (block.variant) {
          case 'h1':
            return fonts.h1.font.replace(/^\S+\s\d+px\s/, '');
          case 'h2':
            return fonts.h2.font.replace(/^\S+\s\d+px\s/, '');
          default:
            return fonts.body.font.replace(/^\S+\s\d+px\s/, '');
        }
      })();
      el.style.lineHeight = `${
        specForBlock(block).measure(block, { width: containerWidth, fonts, collapsed: false }) > 0
          ? (() => {
              switch (block.variant) {
                case 'h1':
                  return fonts.h1.lineHeight;
                case 'h2':
                  return fonts.h2.lineHeight;
                case 'h3':
                case 'h4':
                case 'h5':
                case 'h6':
                  return fonts.h3.lineHeight;
                default:
                  return fonts.body.lineHeight;
              }
            })()
          : fonts.body.lineHeight
      }px`;
      el.textContent = block.runs
        .map((r) => ('text' in r ? r.text : 'label' in r ? r.label : ''))
        .join('');
    } else if (block.tier === 'code') {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = [
        `padding: ${fonts.codeBlockPadY}px ${fonts.codeBlockPadX}px`,
        `border: ${fonts.codeBlockBorder}px solid transparent`,
        'border-radius: 8px',
        'box-sizing: border-box',
      ].join(';');
      if (block.lang) {
        const langEl = document.createElement('div');
        langEl.style.cssText = `font-size:${fonts.codeLang.lineHeight}px;line-height:${fonts.codeLang.lineHeight}px;margin-bottom:6px;`;
        langEl.textContent = block.lang;
        wrapper.appendChild(langEl);
      }
      const preEl = document.createElement('pre');
      const codeFontSize = fonts.code.font.match(/(\d+)px/)?.[1] ?? '12';
      preEl.style.cssText = `margin:0;font-size:${codeFontSize}px;line-height:${fonts.code.lineHeight}px;white-space:pre;`;
      preEl.textContent = block.code;
      wrapper.appendChild(preEl);
      el.appendChild(wrapper);
    }

    outer.appendChild(el);
    const renderedPx = el.getBoundingClientRect().height;
    outer.removeChild(el);

    const driftPx = Math.round((renderedPx - predictedPx) * 10) / 10;
    results.push({
      label,
      predictedPx,
      renderedPx: Math.round(renderedPx),
      ok: Math.abs(driftPx) < 1,
      driftPx,
    });
  }

  document.body.removeChild(outer);
  return results;
}

/**
 * Log parity results to the console.
 * Use during Storybook development or in browser tests.
 */
export function logParityCheck(containerWidth: number, fonts?: FontConfig): void {
  if (typeof document === 'undefined') return;
  const results = runParityCheck(containerWidth, fonts);
  const allOk = results.every((r) => r.ok);
  // eslint-disable-next-line no-console
  console.group(`[ChatUI] Parity ${allOk ? '✅ OK' : '⚠️ DRIFT'} @ width=${containerWidth}`);
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(
      `${r.ok ? '✓' : '✕'} ${r.label.padEnd(30)} predicted=${r.predictedPx}px rendered=${r.renderedPx}px drift=${r.driftPx}px`
    );
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}
