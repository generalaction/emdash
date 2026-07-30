import { ROW_H } from '@components/engine/row-metrics';
import { CollapsibleCard } from '@components/primitives/CollapsibleCard';
import { IconTerminal } from '@components/primitives/icons';
import { measureProseNaturalWidth } from '@components/rows/markdown/prose/layout';
import type { MeasureCtx, RenderCtx } from '@core/define';
import type { ProseBlock } from '@core/markdown/document';
import { defineUnit } from '@core/units';
import { Show, createMemo } from 'solid-js';
import type { ChatExecute } from '@/model';
import { ExecuteBody, type ExecuteDisplayLine } from './Execute';

export { executeFromItem } from './execute.presenter';

export type ExecuteVars = {
  /** Fixed height (px) of the header row. */
  rowH: number;
  /** Border width (px) on each side of the card. */
  border: number;
  /** Horizontal padding on each command line. */
  linePadX: number;
  /** Width and height of the thin native scrollbar. */
  scrollbarSize: number;
  /** Max lines shown in the collapsed (preview) state. */
  collapsedMaxLines: number;
  /** Max lines shown / scrollable in the expanded state. */
  expandedMaxLines: number;
};

const EXECUTE_VARS: ExecuteVars = {
  rowH: ROW_H,
  border: 1,
  linePadX: 12,
  scrollbarSize: 6,
  collapsedMaxLines: 2,
  expandedMaxLines: 16,
};

let measuredScrollbarH: number | undefined;

function scrollbarClearance(maxSize: number): number {
  if (typeof document === 'undefined' || !document.body) return maxSize;
  if (measuredScrollbarH === undefined) {
    const probe = document.createElement('div');
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      width: '100px',
      height: '100px',
      overflow: 'scroll',
      scrollbarWidth: 'thin',
    });
    document.body.appendChild(probe);
    measuredScrollbarH = probe.offsetHeight - probe.clientHeight;
    probe.remove();
  }
  return Math.min(measuredScrollbarH, maxSize);
}

/** 3 borders: top card edge + header-separator + bottom card edge. */
function chromeY(vars: ExecuteVars): number {
  return 3 * vars.border;
}

function commandLines(command: string): string[] {
  return (command || '…').split('\n');
}

function outputLines(outputText: string | undefined): string[] {
  if (!outputText) return [];
  return outputText.replace(/\r\n/g, '\n').split('\n');
}

function executeLines(item: ChatExecute, isExpanded: boolean): ExecuteDisplayLine[] {
  const command = commandLines(item.command).map(
    (line, index): ExecuteDisplayLine => ({
      kind: 'command',
      text: `${index === 0 ? '$' : ' '} ${line}`,
    })
  );
  if (!isExpanded) return command;

  const output = outputLines(item.outputText).map(
    (line): ExecuteDisplayLine => ({ kind: 'output', text: line })
  );
  return output.length > 0 ? [...command, { kind: 'spacer', text: '' }, ...output] : command;
}

function executeBodyH(
  lines: ExecuteDisplayLine[],
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

function executeLineWidth(text: string, ctx: MeasureCtx): number {
  const block: ProseBlock = {
    kind: 'prose',
    id: 'execute-width',
    variant: 'body',
    runs: [{ kind: 'text', text }],
  };
  const codeFonts = { ...ctx.theme.fonts, body: ctx.theme.fonts.code };
  return measureProseNaturalWidth(block, codeFonts);
}

function wrapExpandedCommand(
  lines: ExecuteDisplayLine[],
  ctx: MeasureCtx,
  vars: ExecuteVars
): ExecuteDisplayLine[] {
  const availableWidth = ctx.width - 2 * vars.border - 2 * vars.linePadX;
  const charWidth = executeLineWidth('M', ctx);
  const maxChars = Math.max(1, Math.floor(availableWidth / charWidth));

  return lines.flatMap((line) => {
    if (line.kind !== 'command' || executeLineWidth(line.text, ctx) <= availableWidth) return line;

    let characters = Array.from(line.text);
    const wrapped: ExecuteDisplayLine[] = [];
    while (characters.length > maxChars) {
      let breakAt = maxChars;
      for (let index = maxChars - 1; index > 0; index--) {
        if (/\s/.test(characters[index])) {
          breakAt = index + 1;
          break;
        }
      }
      wrapped.push({ kind: 'command', text: characters.slice(0, breakAt).join('') });
      characters = characters.slice(breakAt);
    }
    wrapped.push({ kind: 'command', text: characters.join('') });
    return wrapped;
  });
}

function hasHorizontalOverflow(
  lines: ExecuteDisplayLine[],
  ctx: MeasureCtx,
  vars: ExecuteVars,
  verticalScrollbarW: number
): boolean {
  const availableWidth = ctx.width - 2 * vars.border - 2 * vars.linePadX - verticalScrollbarW;
  return lines.some((line) => executeLineWidth(line.text, ctx) > availableWidth);
}

function scrollbarSpace(
  lines: ExecuteDisplayLine[],
  ctx: MeasureCtx,
  vars: ExecuteVars,
  hasVerticalOverflow: boolean
): number {
  const verticalScrollbarW = hasVerticalOverflow ? vars.scrollbarSize : 0;
  return hasHorizontalOverflow(lines, ctx, vars, verticalScrollbarW)
    ? scrollbarClearance(vars.scrollbarSize)
    : 0;
}

function executeUnitH(item: ChatExecute, ctx: MeasureCtx, vars: ExecuteVars): number {
  const isExpanded = ctx.expanded(item.id);
  const sourceLines = executeLines(item, isExpanded);
  const lines = isExpanded ? wrapExpandedCommand(sourceLines, ctx, vars) : sourceLines;
  const { bodyH, contentH } = executeBodyH(
    lines,
    ctx.theme.fonts.code.lineHeight,
    isExpanded,
    vars
  );
  const hasVerticalOverflow = isExpanded && contentH > bodyH;
  return vars.rowH + bodyH + scrollbarSpace(lines, ctx, vars, hasVerticalOverflow) + chromeY(vars);
}

function ExecuteUnitRender(props: { data: ChatExecute; ctx: RenderCtx; vars: ExecuteVars }) {
  const mCtx = () => props.ctx.measureCtx?.();
  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const lines = createMemo(() => {
    const sourceLines = executeLines(props.data, isExpanded());
    const ctx = mCtx();
    return isExpanded() && ctx ? wrapExpandedCommand(sourceLines, ctx, props.vars) : sourceLines;
  });
  const codeLineH = createMemo(() => {
    const ctx = mCtx();
    return ctx?.theme.fonts.code.lineHeight ?? 0;
  });
  const bodyGeometry = createMemo(() => {
    const lineH = codeLineH();
    if (!lineH) return { bodyH: 0, contentH: 0 };
    return executeBodyH(lines(), lineH, isExpanded(), props.vars);
  });
  const showScrollbar = createMemo(() => {
    const ctx = mCtx();
    const geometry = bodyGeometry();
    const hasVerticalOverflow = isExpanded() && geometry.contentH > geometry.bodyH;
    const verticalScrollbarW = hasVerticalOverflow ? props.vars.scrollbarSize : 0;
    return ctx ? hasHorizontalOverflow(lines(), ctx, props.vars, verticalScrollbarW) : false;
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
      active={props.data.status === 'running' && !props.data.awaitingPermission}
      error={props.data.status === 'error'}
      errorTitle={props.data.error}
      awaitingPermission={props.data.awaitingPermission}
      icon={<IconTerminal />}
      header={props.data.inputSummary || 'Execute'}
    >
      <Show when={codeLineH() > 0}>
        <ExecuteBody
          item={props.data}
          lines={lines()}
          bodyH={bodyGeometry().bodyH}
          contentH={bodyGeometry().contentH}
          codeLineH={codeLineH()}
          linePadX={props.vars.linePadX}
          scrollbarSize={showScrollbar() ? props.vars.scrollbarSize : 0}
          scrollbarH={showScrollbar() ? scrollbarClearance(props.vars.scrollbarSize) : 0}
          expanded={isExpanded()}
        />
      </Show>
    </CollapsibleCard>
  );
}

export const executeUnitDef = defineUnit<ChatExecute, ExecuteVars>({
  kind: 'execute',
  margin: { top: 2, bottom: 6 },
  vars: EXECUTE_VARS,

  estimate(item, ctx, vars): number {
    // Use the collapsed line cap and current width for stable initial geometry.
    const lines = executeLines(item, false);
    const { bodyH } = executeBodyH(lines, ctx.theme.fonts.code.lineHeight, false, vars);
    return vars.rowH + bodyH + scrollbarSpace(lines, ctx, vars, false) + chromeY(vars);
  },

  measure(item, ctx, vars): number {
    return executeUnitH(item, ctx, vars);
  },

  Render: ExecuteUnitRender,
});
