/**
 * Prose — Solid component rendering a ProseLaidOut block.
 *
 * Each line and fragment is positioned absolutely using pre-computed geometry
 * from the layout engine. Solid's fine-grained reactivity re-renders only the
 * lines that change when content updates (keyed <For>).
 *
 * Visual styles (colors, decorations, chip chrome) use Tailwind utilities.
 * Geometry-coupled rules (font-size, font-family, font-weight, white-space:pre,
 * line-height:1, chip padding) remain in prose.module.css because they feed
 * pretext's width/height measurement.
 */

import { For, Show } from 'solid-js';
import type { InlineRun } from '../../core/blocks/block-types';
import type {
  BulletLayout,
  FragmentLayout,
  LineLayout,
  ProseLaidOut,
} from '../../core/layout/layout-types';
import { BlockFrame } from '../block-frame';
import styles from './prose.module.css';

// ── Fragment ──────────────────────────────────────────────────────────────────

function fragKey(run: InlineRun, variant: string): string {
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(variant)) return `pf--${variant}`;
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

function fragVisualClass(run: InlineRun, variant: string): string {
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(variant)) return '';
  if (run.kind === 'code') return 'rounded bg-[var(--chat-code-inline-bg,rgba(0,0,0,0.06))]';
  if (run.kind === 'mention')
    return 'rounded-full bg-[var(--chat-mention-bg,#dbeafe)] text-[var(--chat-mention-fg,#1d4ed8)]';
  if (run.kind === 'text' && run.href) {
    return 'text-[var(--chat-link,#60a5fa)] underline decoration-[1px] underline-offset-[0.14em] cursor-pointer';
  }
  return '';
}

function ProseFragment(props: { run: InlineRun; frag: FragmentLayout; variant: string }) {
  const key = fragKey(props.run, props.variant);
  const moduleCls = `${styles.pf} ${styles[key] ?? ''}`.trim();
  const visualCls = fragVisualClass(props.run, props.variant);
  const cls = visualCls ? `${moduleCls} ${visualCls}` : moduleCls;

  if (props.run.kind === 'text' && props.run.href) {
    return (
      <a
        class={cls}
        style={{ left: `${props.frag.x}px` }}
        href={props.run.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {props.frag.text}
      </a>
    );
  }

  return (
    <span class={cls} style={{ left: `${props.frag.x}px` }}>
      {props.frag.text}
    </span>
  );
}

// ── Line ──────────────────────────────────────────────────────────────────────

function ProseLine(props: {
  line: LineLayout;
  lineHeight: number;
  runs: InlineRun[];
  variant: string;
}) {
  return (
    <div
      class={styles.pline}
      style={{
        top: `${props.line.top}px`,
        left: `${props.line.left}px`,
        height: `${props.lineHeight}px`,
      }}
    >
      <For each={props.line.fragments}>
        {(frag) => {
          const run = props.runs[frag.runIndex];
          return run ? <ProseFragment run={run} frag={frag} variant={props.variant} /> : null;
        }}
      </For>
    </div>
  );
}

// ── Bullet & QuoteRail ────────────────────────────────────────────────────────

function ProseBullet(props: { bullet: BulletLayout }) {
  return (
    <span
      class={`${styles.pbullet} text-foreground-muted`}
      style={{ left: `${props.bullet.x}px`, top: `${props.bullet.top}px` }}
      aria-hidden="true"
    >
      {props.bullet.char}
    </span>
  );
}

function ProseQuoteRail(props: { left: number }) {
  return (
    <div
      class={`${styles['pquote-rail']} rounded-full bg-border`}
      style={{ left: `${props.left}px` }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export type ProseProps = {
  block: ProseLaidOut;
  runs: InlineRun[];
  variant: string;
};

export function Prose(props: ProseProps) {
  return (
    <BlockFrame layout={props.block}>
      <Show when={props.block.quoteRail}>
        <ProseQuoteRail left={(props.block.lines[0]?.left ?? 18) - 10} />
      </Show>
      <Show when={props.block.bullet}>{(bullet) => <ProseBullet bullet={bullet()} />}</Show>
      <For each={props.block.lines}>
        {(line) => (
          <ProseLine
            line={line}
            lineHeight={props.block.lineHeight}
            runs={props.runs}
            variant={props.variant}
          />
        )}
      </For>
    </BlockFrame>
  );
}
