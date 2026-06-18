/**
 * Code — Solid component rendering a CodeLaidOut block.
 *
 * Renders plain text first (synchronous), then applies Shiki highlighting
 * asynchronously on an idle callback.
 *
 * Layout: BlockFrame positions the block (absolute, full-width, height from
 * layout). Inside it:
 *   - CopyButton: absolute top-right, stays pinned because it is a sibling of
 *     the scroll container (not inside it).
 *   - inner div: absolute inset-0, is the actual scroll+card element. It has
 *     no .pblock class, so overflow-x-auto wins without a specificity fight
 *     against block-frame's `overflow: visible` base rule.
 *
 * Shiki writes --shiki-light-bg / --shiki-dark-bg as inline custom properties
 * onto wrapperEl (the inner div), which carries the background Tailwind class.
 */

import { For, createEffect, onCleanup } from 'solid-js';
import { applyTokenLines } from '../../core/highlight/apply-tokens';
import type { CodeLaidOut } from '../../core/layout/layout-types';
import type { CodeBlock } from '../../core/markdown/document';
import { BlockFrame } from '../block-frame';
import { useCaches } from '../CachesContext';
import { cancelIdle, scheduleIdle } from '../dom-utils';
import { CopyButton } from '../primitives/CopyButton';

export type CodeProps = {
  block: CodeLaidOut;
  rawBlock: CodeBlock;
};

export function Code(props: CodeProps) {
  const caches = useCaches();
  const lineElsMap: Map<number, HTMLElement> = new Map();
  let wrapperEl: HTMLElement | undefined;

  createEffect(() => {
    if (!wrapperEl) return;
    const lang = props.block.lang;
    if (!lang) return;

    const code = props.rawBlock.code;

    // Synchronous fast-path on cache hit
    const cached = caches.peekHighlight(code, lang);
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
      applyTokenLines(lineEls, cached.lines);
      return;
    }

    // Deferred path
    let cancelled = false;
    const handle = scheduleIdle(() => {
      if (cancelled) return;
      const hl = caches.highlight(code, lang);
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
      applyTokenLines(lineEls, hl.lines);
    });

    onCleanup(() => {
      cancelled = true;
      cancelIdle(handle);
    });
  });

  return (
    <BlockFrame layout={props.block} class="group">
      {/*
       * Pinned copy button — sibling of the scroll container so it stays
       * fixed at top-right regardless of horizontal scroll position.
       */}
      <CopyButton text={props.rawBlock.code} variant="overlay" label="Copy code" />

      {/*
       * Scroll + card container. `absolute inset-0` makes its border-box equal
       * the frame box, preserving the reserved height arithmetic. Having no
       * .pblock class means overflow-x-auto wins without any specificity tie.
       *
       * bg-[var(...)] references the same --shiki-light-bg / --chat-code-bg
       * vars that Shiki writes at runtime so the background transitions smoothly
       * from the pre-highlight fallback to the theme colour.
       *
       * [&_span] targets the imperatively-created token <span>s from
       * apply-tokens.ts, which have no Tailwind class of their own.
       */}
      <div
        ref={(el) => {
          wrapperEl = el;
        }}
        class={[
          'absolute inset-0 overflow-x-auto overflow-y-hidden rounded-lg',
          'border border-border pl-2',
          'scrollbar-thin',
          'bg-(--shiki-light-bg,var(--chat-code-bg))',
          'emdark:bg-(--shiki-dark-bg,var(--chat-code-bg))',
          '[&_span]:text-(--shiki-light)',
          'emdark:[&_span]:text-(--shiki-dark)',
        ].join(' ')}
      >
        <For each={props.block.lines}>
          {(line, i) => (
            <div
              ref={(el) => {
                lineElsMap.set(i(), el);
                onCleanup(() => lineElsMap.delete(i()));
              }}
              class={[
                'absolute whitespace-pre text-foreground font-normal',
                'text-(length:--chat-code-size) leading-(--chat-code-lh)',
                '[font-family:var(--type-code-font-family)]',
              ].join(' ')}
              style={{ top: `${line.top}px` }}
            >
              {line.text}
            </div>
          )}
        </For>
      </div>
    </BlockFrame>
  );
}
