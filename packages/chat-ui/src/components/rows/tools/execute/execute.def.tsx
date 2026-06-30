import { ROW_H } from '@components/engine/row-metrics';
import { CollapsibleCard } from '@components/primitives/CollapsibleCard';
import type { MeasureCtx, RenderCtx } from '@core/define';
import { defineUnit } from '@core/units';
import { Show, createMemo } from 'solid-js';
import type { ChatExecute } from '@/model';
import { ExecuteBody } from './Execute';

// ── Vars ──────────────────────────────────────────────────────────────────────

export type ExecuteVars = {
  /** Fixed height (px) of the header row. */
  rowH: number;
  /** Border width (px) on each side of the card. */
  border: number;
  /** Max lines shown in the collapsed (preview) state. */
  collapsedMaxLines: number;
  /** Max lines shown / scrollable in the expanded state. */
  expandedMaxLines: number;
};

const EXECUTE_VARS: ExecuteVars = {
  rowH: ROW_H,
  border: 1,
  collapsedMaxLines: 3,
  expandedMaxLines: 16,
};

// ── Geometry ──────────────────────────────────────────────────────────────────

/** 3 borders: top card edge + header-separator + bottom card edge. */
function chromeY(vars: ExecuteVars): number {
  return 3 * vars.border;
}

function commandLines(command: string): string[] {
  return (command || '…').split('\n');
}

function executeBodyH(
  lines: string[],
  codeLineH: number,
  isExpanded: boolean,
  vars: ExecuteVars
): { bodyH: number; contentH: number } {
  const contentH = lines.length * codeLineH;
  const maxLines = isExpanded ? vars.expandedMaxLines : vars.collapsedMaxLines;
  const cap = maxLines * codeLineH;
  const bodyH = Math.min(contentH, cap);
  return { bodyH, contentH };
}

function executeUnitH(item: ChatExecute, ctx: MeasureCtx, vars: ExecuteVars): number {
  const isExpanded = ctx.expanded(item.id);
  const lines = commandLines(item.command);
  const { bodyH } = executeBodyH(lines, ctx.theme.fonts.code.lineHeight, isExpanded, vars);
  return vars.rowH + bodyH + chromeY(vars);
}

// ── Render ────────────────────────────────────────────────────────────────────

function ExecuteUnitRender(props: { data: ChatExecute; ctx: RenderCtx; vars: ExecuteVars }) {
  const mCtx = () => props.ctx.measureCtx?.();
  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const lines = createMemo(() => commandLines(props.data.command));
  const codeLineH = createMemo(() => mCtx()?.theme.fonts.code.lineHeight ?? 0);

  const bodyGeometry = createMemo(() => {
    const lineH = codeLineH();
    if (!lineH) return { bodyH: 0, contentH: 0 };
    return executeBodyH(lines(), lineH, isExpanded(), props.vars);
  });

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return props.vars.rowH + chromeY(props.vars);
    return executeUnitH(props.data, ctx, props.vars);
  });

  return (
    <CollapsibleCard
      id={props.data.id}
      ctx={props.ctx}
      height={totalH()}
      headerH={props.vars.rowH}
      expanded={isExpanded()}
      active={props.data.status === 'running'}
      error={props.data.status === 'error'}
      header="Execute"
    >
      <Show when={codeLineH() > 0}>
        <ExecuteBody
          item={props.data}
          lines={lines()}
          bodyH={bodyGeometry().bodyH}
          contentH={bodyGeometry().contentH}
          codeLineH={codeLineH()}
          expanded={isExpanded()}
        />
      </Show>
    </CollapsibleCard>
  );
}

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const executeUnitDef = defineUnit<ChatExecute, ExecuteVars>({
  kind: 'execute',
  margin: { top: 2, bottom: 6 },
  vars: EXECUTE_VARS,

  estimate(item, _ctx, vars): number {
    // O(1) cheap estimate: use collapsedMaxLines cap (default state).
    const lines = commandLines(item.command);
    // Approximate code line height — use a fixed fallback of 20px for estimate.
    const approxLineH = 20;
    const { bodyH } = executeBodyH(lines, approxLineH, false, vars);
    return vars.rowH + bodyH + chromeY(vars);
  },

  measure(item, ctx, vars): number {
    return executeUnitH(item, ctx, vars);
  },

  Render: ExecuteUnitRender,
});
