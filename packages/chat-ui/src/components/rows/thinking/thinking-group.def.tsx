import { useTheme } from '@components/contexts/ThemeContext';
import { HEADER_ROW_EXTRA_H } from '@components/engine/row-metrics';
import { CollapseHeader } from '@components/primitives/CollapseHeader';
import type { MeasureCtx, RenderCtx } from '@core/define';
import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { ChatThinking, ThinkingGroupItem } from '@/model';
import {
  THINKING_VARS,
  ThinkingUnitRender,
  thinkingMeasure,
  thinkingUnitDef,
} from './thinking.def';
import { thinkingCardVars, thinkingGroupChild, thinkingRoot } from './thinking.css';
import { sx } from '@styles/sprinkles.css';

type ThinkingGroupVars = {
  childGap: number;
};

const THINKING_GROUP_VARS: ThinkingGroupVars = {
  childGap: 6,
};

function headerH(ctx: MeasureCtx): number {
  return ctx.theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
}

function activeStep(item: ThinkingGroupItem): ChatThinking | undefined {
  for (let i = item.steps.length - 1; i >= 0; i -= 1) {
    if (item.steps[i].status === 'thinking') return item.steps[i];
  }
  return undefined;
}

function groupDurationMs(item: ThinkingGroupItem, now: number): number | undefined {
  let total = 0;
  for (const step of item.steps) {
    if (step.status === 'thinking') {
      total += Math.max(0, now - step.startedAt);
      continue;
    }
    if (step.durationMs === undefined) return undefined;
    total += step.durationMs;
  }
  return total;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return '<1s';
  return `${Math.floor(durationMs / 1000)}s`;
}

function ThinkingGroupHeader(props: {
  item: ThinkingGroupItem;
  expanded: boolean;
  height: number;
}) {
  const [now, setNow] = createSignal(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    clearInterval(timer);
    timer = undefined;
    if (!activeStep(props.item)) return;

    setNow(Date.now());
    timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  const label = () => {
    const active = activeStep(props.item);
    const duration = groupDurationMs(props.item, now());
    if (active) {
      return `Reasoning · step ${props.item.steps.length}${duration === undefined ? '' : ` · ${formatDuration(duration)}`}`;
    }
    return `Reasoned in ${props.item.steps.length} steps${duration === undefined ? '' : ` · ${formatDuration(duration)}`}`;
  };

  return (
    <CollapseHeader
      id={props.item.id}
      expanded={props.expanded}
      active={activeStep(props.item) !== undefined}
      height={props.height}
    >
      {label()}
    </CollapseHeader>
  );
}

function childrenH(item: ThinkingGroupItem, ctx: MeasureCtx, vars: ThinkingGroupVars): number {
  return item.steps.reduce(
    (height, step) => height + vars.childGap + thinkingMeasure(step, ctx, THINKING_VARS),
    0
  );
}

function thinkingGroupH(item: ThinkingGroupItem, ctx: MeasureCtx, vars: ThinkingGroupVars): number {
  const height = headerH(ctx);
  return ctx.expanded(item.id) ? height + childrenH(item, ctx, vars) : height;
}

function ThinkingGroupRender(props: {
  data: ThinkingGroupItem;
  ctx: RenderCtx;
  vars: ThinkingGroupVars;
}) {
  const theme = useTheme();
  const mCtx = () => props.ctx.measureCtx?.();
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);
  const hH = () => theme().fonts.body.lineHeight + HEADER_ROW_EXTRA_H;

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return hH();
    return thinkingGroupH(props.data, ctx, props.vars);
  });

  return (
    <div
      class={`${sx({ color: 'fgPassive' })} ${thinkingRoot}`}
      style={assignInlineVars(thinkingCardVars, pxTokens({ height: totalH() }))}
    >
      <ThinkingGroupHeader item={props.data} expanded={isExpanded()} height={hH()} />
      <Show when={isExpanded()}>
        <For each={props.data.steps}>
          {(step) => (
            <div class={thinkingGroupChild}>
              <ThinkingUnitRender data={step} ctx={props.ctx} vars={THINKING_VARS} />
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

export const thinkingGroupUnitDef = defineUnit<ThinkingGroupItem, ThinkingGroupVars>({
  kind: 'thinking-group',
  margin: { top: 6, bottom: 6 },
  vars: THINKING_GROUP_VARS,

  estimate(item, ctx, vars): number {
    const height = headerH(ctx);
    if (!ctx.expanded(item.id)) return height;

    const estimateStep = thinkingUnitDef.estimate;
    return item.steps.reduce(
      (total, step) =>
        total +
        vars.childGap +
        (estimateStep
          ? estimateStep(step, ctx, THINKING_VARS)
          : thinkingMeasure(step, ctx, THINKING_VARS)),
      height
    );
  },

  measure: thinkingGroupH,
  Render: ThinkingGroupRender,
});
