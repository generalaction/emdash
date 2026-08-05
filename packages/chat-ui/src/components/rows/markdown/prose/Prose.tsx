import { useCommands } from '@components/contexts/CommandsContext';
import { useStreamAnimation } from '@components/contexts/StreamContext';
import { useTheme } from '@components/contexts/ThemeContext';
import { BlockFrame } from '@components/engine/block-frame';
import {
  MentionAtIcon,
  MentionFileIcon,
  MentionIssueIcon,
  MentionSymbolIcon,
} from '@components/primitives/icons';
import type {
  BulletLayout,
  FragmentLayout,
  LineLayout,
  ProseLaidOut,
} from '@core/layout/layout-types';
import { mentionDisplayText } from '@core/markdown/document';
import type { InlineMention, InlineRun } from '@core/markdown/document';
import { Index, Match, Show, Switch, createEffect, createMemo } from 'solid-js';
import {
  bulletColor,
  commandChip,
  inlineCodeChip,
  linkFragment,
  mentionChip,
  mentionChipByKind,
  mentionPlain,
  pbullet,
  pf,
  pfVariants,
  pline,
  pquoteRail,
  quoteRailBar,
} from './prose.css';
import { streamWord } from '@styles/effects.css';

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
  if (run.kind === 'code') return inlineCodeChip;
  if (run.kind === 'mention') {
    const mention = run as InlineMention;
    // Slash-command chips use a dedicated style.
    if (mention.tone === 'command') return commandChip;
    // Resolved context mentions use per-kind background colors.
    // Plain/math mentions (no mentionKind) keep the rounded-full blue tint.
    if (mention.mentionKind) return mentionChipByKind[mention.mentionKind] ?? mentionChip;
    return mentionPlain;
  }
  if (run.kind === 'text' && run.href) return linkFragment;
  return '';
}

// ── Word-splitting for streaming animation ────────────────────────────────────

/**
 * Split a fragment's text into alternating word/space runs, preserving
 * `white-space: pre` semantics (no trimming, no merging of spaces).
 * Carries a stable word index so existing word nodes can survive streaming updates.
 */
function splitFragmentWords(
  text: string
): Array<{ text: string; isWord: boolean; wordIndex: number }> {
  const parts = text.split(/(\s+)/);
  const result: Array<{ text: string; isWord: boolean; wordIndex: number }> = [];
  let wordIndex = 0;
  for (const p of parts) {
    if (p.length === 0) continue;
    const isWord = /\S/.test(p);
    result.push({ text: p, isWord, wordIndex: isWord ? wordIndex++ : -1 });
  }
  return result;
}

// ── Fragment ──────────────────────────────────────────────────────────────────

function ProseFragment(props: {
  run: InlineRun;
  frag: FragmentLayout;
  variant: string;
  blockId: string;
  /** Absolute word index of the first word in this fragment (0-based). Set only when streaming. */
  wordOffset?: number;
  /** Total word count in the block. Set only when streaming. */
  totalWords?: number;
  /** Frontier: words already revealed on the previous render. Set only when streaming. */
  frontier?: number;
}) {
  const commands = useCommands();
  const chips = useTheme()().chips;
  const cls = () => {
    const key = fragKey(props.run, props.variant);
    const moduleCls = [pf, pfVariants[key]].filter(Boolean).join(' ');
    const visualCls = fragVisualClass(props.run, props.variant);
    return visualCls ? `${moduleCls} ${visualCls}` : moduleCls;
  };
  const fragmentStyle = () => ({
    'margin-left': `${props.frag.gapBefore}px`,
    width: `${props.frag.occupiedWidth}px`,
  });
  const linkHref = () => (props.run.kind === 'text' ? props.run.href : undefined);
  const mention = () => {
    if (props.run.kind !== 'mention' || !props.run.mentionKind) return undefined;
    return props.run as InlineMention;
  };
  const isStreamingText = () =>
    props.run.kind === 'text' &&
    !/^\s+$/.test(props.frag.text) &&
    props.wordOffset !== undefined &&
    props.frontier !== undefined &&
    props.totalWords !== undefined;
  const wordPairs = createMemo(() => splitFragmentWords(props.frag.text));

  const handleLinkClick = (e: MouseEvent) => {
    const href = linkHref();
    if (!href) return;
    const result = commands().classifyLink?.(href);
    if (result?.kind === 'workspace-file') {
      e.preventDefault();
      commands().onOpenFile?.({
        path: result.path,
        itemId: props.blockId,
        source: 'prose-link',
      });
    }
  };

  const handleMentionClick = () => {
    const value = mention();
    if (!value?.mentionKind) return;
    commands().onClickMention?.({
      id: value.id ?? value.label,
      label: value.label,
      kind: value.mentionKind,
      itemId: props.blockId,
      source: 'prose-mention',
    });
  };

  const isNewMention = () =>
    props.wordOffset !== undefined &&
    props.frontier !== undefined &&
    props.wordOffset >= props.frontier;
  const isMentionClickable = () => !!commands().onClickMention;

  return (
    <Switch
      fallback={
        <span class={cls()} style={fragmentStyle()}>
          {props.frag.text}
        </span>
      }
    >
      <Match when={linkHref()}>
        {(href) => (
          <a
            class={cls()}
            style={fragmentStyle()}
            href={href()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
          >
            {props.frag.text}
          </a>
        )}
      </Match>
      <Match when={mention()}>
        {(value) => (
          <span
            class={cls()}
            classList={{ [streamWord]: isNewMention() }}
            onClick={handleMentionClick}
            style={{
              cursor: isMentionClickable() ? 'pointer' : undefined,
              ...fragmentStyle(),
              display: 'inline-flex',
              'align-items': 'center',
              gap: `${chips.mentionIconGap}px`,
            }}
          >
            <span
              style={{
                display: 'flex',
                width: `${chips.mentionIconW}px`,
                height: `${chips.mentionIconW}px`,
                'flex-shrink': '0',
                'align-items': 'center',
                'justify-content': 'center',
                overflow: 'hidden',
              }}
            >
              <Show
                when={value().iconUrl}
                fallback={
                  <Show
                    when={value().iconClass}
                    fallback={
                      <Switch fallback={<MentionAtIcon />}>
                        <Match when={value().mentionKind === 'file'}>
                          <MentionFileIcon />
                        </Match>
                        <Match when={value().mentionKind === 'issue'}>
                          <MentionIssueIcon />
                        </Match>
                        <Match when={value().mentionKind === 'symbol'}>
                          <MentionSymbolIcon />
                        </Match>
                      </Switch>
                    }
                  >
                    {(ic) => <i class={`${ic()} leading-none`} style={{ 'font-size': '11px' }} />}
                  </Show>
                }
              >
                {(url) => (
                  <img
                    src={url()}
                    alt=""
                    style={{ width: '100%', height: '100%', 'object-fit': 'contain' }}
                  />
                )}
              </Show>
            </span>
            <span>{mentionDisplayText(value())}</span>
          </span>
        )}
      </Match>
      <Match when={isStreamingText()}>
        <span class={cls()} style={fragmentStyle()}>
          <Index each={wordPairs()}>
            {(pair) => (
              <Show when={pair().isWord} fallback={<>{pair().text}</>}>
                <span
                  classList={{
                    [streamWord]: props.wordOffset! + pair().wordIndex >= props.frontier!,
                  }}
                >
                  {pair().text}
                </span>
              </Show>
            )}
          </Index>
        </span>
      </Match>
    </Switch>
  );
}

// ── Line ──────────────────────────────────────────────────────────────────────

function ProseLine(props: {
  line: LineLayout;
  gapBefore: number;
  lineHeight: number;
  runs: InlineRun[];
  variant: string;
  blockId: string;
  /** Per-fragment word offsets. Present only when streaming. */
  fragWordOffsets?: number[];
  totalWords?: number;
  frontier?: number;
}) {
  return (
    <div
      class={pline}
      style={{
        'margin-top': `${props.gapBefore}px`,
        left: `${props.line.left}px`,
        height: `${props.lineHeight}px`,
      }}
    >
      <Index each={props.line.fragments}>
        {(frag, i) => {
          return (
            <Show when={props.runs[frag().runIndex]}>
              {(run) => (
                <ProseFragment
                  run={run()}
                  frag={frag()}
                  variant={props.variant}
                  blockId={props.blockId}
                  wordOffset={props.fragWordOffsets?.[i]}
                  totalWords={props.totalWords}
                  frontier={props.frontier}
                />
              )}
            </Show>
          );
        }}
      </Index>
    </div>
  );
}

// ── Bullet & QuoteRail ────────────────────────────────────────────────────────

function ProseBullet(props: { bullet: BulletLayout }) {
  return (
    <span
      class={`${pbullet} ${bulletColor}`}
      style={{ left: `${props.bullet.x}px`, top: `${props.bullet.top}px` }}
      aria-hidden="true"
    >
      {props.bullet.char}
    </span>
  );
}

function ProseQuoteRail(props: { left: number }) {
  return <div class={`${pquoteRail} ${quoteRailBar}`} style={{ left: `${props.left}px` }} />;
}

// ── Main component ────────────────────────────────────────────────────────────

export type ProseProps = {
  block: ProseLaidOut;
  runs: InlineRun[];
  variant: string;
};

export function Prose(props: ProseProps) {
  const streamAnim = useStreamAnimation();

  // Pre-compute per-fragment word offsets, the block total, and a per-line
  // base-flat index so that ProseFragment can determine whether each word is
  // new without scanning the whole block. Rebuilt whenever lines/runs change
  // (i.e. each streaming tick).
  //
  // lineBaseFlat[i] = total fragment count across lines 0…i-1, so a fragment
  // at (lineIdx, fragIdx) maps to fragWordOffsets[lineBaseFlat[lineIdx] + fragIdx]
  // in O(1) rather than summing per-line counts on every access (was O(lines^2)).
  const fragData = createMemo<{
    fragWordOffsets: number[];
    lineBaseFlat: number[];
    totalWords: number;
    frontier: number;
  } | null>(() => {
    if (!streamAnim) return null;

    const offsets: number[] = [];
    const lineBaseFlat: number[] = [];
    let cursor = 0;

    for (const line of props.block.lines) {
      lineBaseFlat.push(offsets.length);
      for (const frag of line.fragments) {
        offsets.push(cursor);
        const run = props.runs[frag.runIndex];
        if (run && run.kind === 'text' && !/^\s+$/.test(frag.text)) {
          // Count only non-space words (matching splitFragmentWords logic).
          const words = frag.text.split(/\s+/).filter((w) => w.length > 0);
          cursor += words.length;
        } else if (run && run.kind !== 'text') {
          // Non-text runs (code chip, mention) count as 1 unit.
          cursor += 1;
        }
        // Pure-whitespace fragments and breaks contribute 0.
      }
    }

    return {
      fragWordOffsets: offsets,
      lineBaseFlat,
      totalWords: cursor,
      frontier: streamAnim.frontier.get(props.block.id) ?? 0,
    };
  });

  // After rendering, advance the frontier so the next chunk only animates
  // words appended after this render.
  createEffect(() => {
    if (!streamAnim) return;
    const d = fragData();
    if (d) streamAnim.frontier.set(props.block.id, d.totalWords);
  });

  return (
    <BlockFrame layout={props.block}>
      <Show when={props.block.quoteRail}>
        <ProseQuoteRail left={(props.block.lines[0]?.left ?? 18) - 10} />
      </Show>
      <Show when={props.block.bullet}>{(bullet) => <ProseBullet bullet={bullet()} />}</Show>
      <Index each={props.block.lines}>
        {(line, lineIdx) => {
          const lineFragOffsets = () => {
            const d = fragData();
            return d
              ? line().fragments.map(
                  (_, fi) => d.fragWordOffsets[d.lineBaseFlat[lineIdx] + fi] ?? 0
                )
              : undefined;
          };
          const previous = () => props.block.lines[lineIdx - 1];
          const previousBottom = () => {
            const value = previous();
            return value ? value.top + props.block.lineHeight : 0;
          };
          return (
            <ProseLine
              line={line()}
              gapBefore={line().top - previousBottom()}
              lineHeight={props.block.lineHeight}
              runs={props.runs}
              variant={props.variant}
              blockId={props.block.id}
              fragWordOffsets={lineFragOffsets()}
              totalWords={fragData()?.totalWords}
              frontier={fragData()?.frontier}
            />
          );
        }}
      </Index>
    </BlockFrame>
  );
}
