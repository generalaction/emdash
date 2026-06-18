/**
 * Code — Solid component rendering a CodeLaidOut block.
 *
 * Renders plain text first (synchronous), then applies Shiki highlighting
 * asynchronously on an idle callback.
 *
 * Positioning is handled by BlockFrame; this component only describes content.
 */

import { For, createEffect, onCleanup } from 'solid-js';
import type { CodeBlock } from '../../core/markdown/document';
import { applyTokenLines } from '../../core/highlight/apply-tokens';
import type { CodeLaidOut } from '../../core/layout/layout-types';
import { BlockFrame } from '../block-frame';
import { useCaches } from '../CachesContext';
import { cancelIdle, scheduleIdle } from '../dom-utils';
import { CopyButton } from '../primitives/CopyButton';
import styles from './code.module.css';

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
    <BlockFrame
      layout={props.block}
      class={`${styles['pcode-block']} group overflow-x-auto overflow-y-hidden rounded-lg`}
      ref={(el) => {
        wrapperEl = el;
      }}
    >
      <CopyButton text={props.rawBlock.code} variant="overlay" label="Copy code" />
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
