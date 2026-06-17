/**
 * Code — Solid component rendering a CodeLaidOut block.
 *
 * Renders plain text first (synchronous), then applies Shiki highlighting
 * asynchronously on an idle callback.
 *
 * Positioning is handled by BlockFrame; this component only describes content.
 */

import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { CodeBlock } from '../../core/blocks/block-types';
import { highlightCode, peekHighlight } from '../../core/highlight/highlighter';
import type { CodeLaidOut } from '../../core/layout/layout-types';
import { BlockFrame } from '../block-frame';
import { cancelIdle, scheduleIdle } from '../dom-utils';
import styles from './code.module.css';

export type CodeProps = {
  block: CodeLaidOut;
  rawBlock: CodeBlock;
};

function applyHighlight(
  lineEls: HTMLElement[],
  hl: {
    rootStyle: string;
    lines: Array<Array<{ content: string; htmlStyle?: Record<string, string> }>>;
  }
): void {
  for (let i = 0; i < lineEls.length; i++) {
    const lineEl = lineEls[i];
    const tokens = hl.lines[i];
    if (!lineEl || !tokens) continue;
    while (lineEl.firstChild) lineEl.removeChild(lineEl.firstChild);
    for (const tok of tokens) {
      if (!tok.content) continue;
      if (!tok.htmlStyle) {
        lineEl.appendChild(document.createTextNode(tok.content));
      } else {
        const span = document.createElement('span');
        span.textContent = tok.content;
        for (const [prop, val] of Object.entries(tok.htmlStyle)) {
          span.style.setProperty(prop, val);
        }
        lineEl.appendChild(span);
      }
    }
  }
}

function IconCopy() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,8 6,12 14,4" />
    </svg>
  );
}

function CopyCodeButton(props: { text: string }) {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const handleClick = () => {
    void navigator.clipboard.writeText(props.text).then(() => {
      setCopied(true);
      resetTimer = setTimeout(() => {
        setCopied(false);
        resetTimer = undefined;
      }, 1500);
    });
  };

  onCleanup(() => {
    if (resetTimer !== undefined) clearTimeout(resetTimer);
  });

  return (
    <button
      type="button"
      class="absolute top-1.5 right-1.5 z-10 flex cursor-pointer items-center justify-center rounded p-0.5 text-foreground-passive opacity-0 transition-opacity select-none group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      aria-label={copied() ? 'Copied' : 'Copy code'}
      onClick={handleClick}
    >
      <Show when={copied()} fallback={<IconCopy />}>
        <IconCheck />
      </Show>
    </button>
  );
}

export function Code(props: CodeProps) {
  const lineElsMap: Map<number, HTMLElement> = new Map();
  let wrapperEl: HTMLElement | undefined;

  createEffect(() => {
    if (!wrapperEl) return;
    const lang = props.block.lang;
    if (!lang) return;

    const code = props.rawBlock.code;

    // Synchronous fast-path on cache hit
    const cached = peekHighlight(code, lang);
    if (cached) {
      const lineEls = Array.from(lineElsMap.values());
      if (cached.rootStyle) {
        for (const decl of cached.rootStyle.split(';')) {
          const colon = decl.indexOf(':');
          if (colon === -1) continue;
          const prop = decl.slice(0, colon).trim();
          const val = decl.slice(colon + 1).trim();
          if (prop) wrapperEl!.style.setProperty(prop, val);
        }
      }
      applyHighlight(lineEls, cached);
      return;
    }

    // Deferred path
    let cancelled = false;
    const handle = scheduleIdle(() => {
      if (cancelled) return;
      const hl = highlightCode(code, lang);
      if (!hl || cancelled) return;
      const el = wrapperEl;
      if (!el) return;
      if (hl.rootStyle) {
        for (const decl of hl.rootStyle.split(';')) {
          const colon = decl.indexOf(':');
          if (colon === -1) continue;
          const prop = decl.slice(0, colon).trim();
          const val = decl.slice(colon + 1).trim();
          if (prop) el.style.setProperty(prop, val);
        }
      }
      const lineEls = Array.from(lineElsMap.values());
      applyHighlight(lineEls, hl);
    });

    onCleanup(() => {
      cancelled = true;
      cancelIdle(handle);
    });
  });

  return (
    <BlockFrame
      layout={props.block}
      class={`${styles['pcode-block']} group overflow-x-auto overflow-y-hidden rounded-lg`}
      ref={(el) => {
        wrapperEl = el;
      }}
    >
      <CopyCodeButton text={props.rawBlock.code} />
      <For each={props.block.lines}>
        {(line, i) => (
          <div
            ref={(el) => {
              lineElsMap.set(i(), el);
              onCleanup(() => lineElsMap.delete(i()));
            }}
            class={`${styles['pcode-line']} text-foreground`}
            style={{ top: `${line.top}px` }}
          >
            {line.text}
          </div>
        )}
      </For>
    </BlockFrame>
  );
}
