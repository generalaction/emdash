import type { SegmentCtx } from '@core/units';
import type { ChatExecute, ToolNode } from '@/model';

export function executeFromItem(
  item: Extract<ToolNode, { kind: 'execute-tool-call' }>,
  ctx: SegmentCtx
): ChatExecute {
  const liveOutput = item.terminalId ? ctx.terminalOutputText(item.terminalId) : null;
  const outputText = liveOutput ?? item.outputText;
  return {
    kind: 'execute',
    id: item.id,
    command: item.command ?? item.title,
    ...(outputText !== undefined ? { outputText } : {}),
    status: item.status,
    awaitingPermission: ctx.pendingToolCallIds().has(item.toolCallId),
    startedAt: 0,
    ...(item.terminalId !== undefined ? { terminalId: item.terminalId } : {}),
  };
}
