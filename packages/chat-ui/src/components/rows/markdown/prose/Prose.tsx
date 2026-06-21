import { useCommands } from '@components/contexts/CommandsContext';
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
import type { InlineMention, InlineRun } from '@core/markdown/document';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { For, Match, Show, Switch } from 'solid-js';
import { MENTION_ICON_GAP, MENTION_ICON_W, MENTION_PAD_X, MENTION_PAD_Y } from './metrics';
import {
  bulletColor,
  inlineCodeChip,
  linkFragment,
  mentionChip,
  mentionPlain,
  pbullet,
  pf,
  pfVariants,
  pline,
  pquoteRail,
  proseVars,
  quoteRailBar,
} from './prose.css';

const PROSE_STYLE_VARS = pxTokens({
  mentionPadX: MENTION_PAD_X,
  mentionPadY: MENTION_PAD_Y,
  mentionIconW: MENTION_ICON_W,
  mentionIconGap: MENTION_ICON_GAP,
});

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
    // Resolved context mentions mirror the ChatComposer pill: a neutral chip
    // with a hairline ring. Plain/math mentions keep the rounded-full blue tint.
    if ((run as InlineMention).mentionKind) return mentionChip;
    return mentionPlain;
  }
  if (run.kind === 'text' && run.href) return linkFragment;
  return '';
}

function ProseFragment(props: {
  run: InlineRun;
  frag: FragmentLayout;
  variant: string;
  blockId: string;
}) {
  const commands = useCommands();
  const key = fragKey(props.run, props.variant);
  const moduleCls = [pf, pfVariants[key]].filter(Boolean).join(' ');
  const visualCls = fragVisualClass(props.run, props.variant);
  const cls = visualCls ? `${moduleCls} ${visualCls}` : moduleCls;

  if (props.run.kind === 'text' && props.run.href) {
    const href = props.run.href;
    const classification = () => commands().classifyLink?.(href);

    const handleClick = (e: MouseEvent) => {
      const result = classification();
      if (result?.kind === 'workspace-file') {
        e.preventDefault();
        commands().onOpenFile?.({
          path: result.path,
          itemId: props.blockId,
          source: 'prose-link',
        });
      }
      // else: browser follows the <a> normally (new tab via target="_blank")
    };

    return (
      <a
        class={cls}
        style={{ left: `${props.frag.x}px` }}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
      >
        {props.frag.text}
      </a>
    );
  }

  if (props.run.kind === 'mention' && (props.run as InlineMention).mentionKind) {
    const mention = props.run as InlineMention;
    return (
      <span
        class={cls}
        style={{
          left: `${props.frag.x}px`,
          display: 'inline-flex',
          'align-items': 'center',
          gap: proseVars.mentionIconGap,
        }}
      >
        <span
          style={{
            display: 'flex',
            width: proseVars.mentionIconW,
            height: proseVars.mentionIconW,
            'flex-shrink': '0',
            'align-items': 'center',
            'justify-content': 'center',
            overflow: 'hidden',
          }}
        >
          <Show
            when={mention.iconClass}
            fallback={
              <Switch fallback={<MentionAtIcon />}>
                <Match when={mention.mentionKind === 'file'}>
                  <MentionFileIcon />
                </Match>
                <Match when={mention.mentionKind === 'issue'}>
                  <MentionIssueIcon />
                </Match>
                <Match when={mention.mentionKind === 'symbol'}>
                  <MentionSymbolIcon />
                </Match>
              </Switch>
            }
          >
            {(ic) => <i class={`${ic()} leading-none`} style={{ 'font-size': '12px' }} />}
          </Show>
        </span>
        <span>{mention.name ?? mention.label}</span>
      </span>
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
  blockId: string;
}) {
  return (
    <div
      class={pline}
      style={{
        top: `${props.line.top}px`,
        left: `${props.line.left}px`,
        height: `${props.lineHeight}px`,
      }}
    >
      <For each={props.line.fragments}>
        {(frag) => {
          const run = props.runs[frag.runIndex];
          return run ? (
            <ProseFragment run={run} frag={frag} variant={props.variant} blockId={props.blockId} />
          ) : null;
        }}
      </For>
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
  return (
    <BlockFrame layout={props.block} style={assignInlineVars(proseVars, PROSE_STYLE_VARS)}>
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
            blockId={props.block.id}
          />
        )}
      </For>
    </BlockFrame>
  );
}
