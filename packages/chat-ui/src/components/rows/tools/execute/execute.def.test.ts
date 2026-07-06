import type { SegmentCtx } from '@core/units';
import { describe, expect, it } from 'vitest';
import type { ToolNode } from '@/model';
import { executeFromItem } from './execute.presenter';

function executeItem(overrides: Partial<Extract<ToolNode, { kind: 'execute-tool-call' }>> = {}) {
  return {
    kind: 'execute-tool-call',
    id: 'tool-1',
    seq: 0,
    toolCallId: 'call-1',
    title: 'echo ok',
    command: 'echo ok',
    status: 'done',
    ...overrides,
  } satisfies Extract<ToolNode, { kind: 'execute-tool-call' }>;
}

function ctx(outputText: string | null): SegmentCtx {
  return {
    caches: {} as SegmentCtx['caches'],
    expanded: () => false,
    active: false,
    plan: () => null,
    pendingToolCallIds: () => new Set<string>(),
    terminalOutputText: () => outputText,
  };
}

describe('executeFromItem', () => {
  it('passes static outputText through when no terminal id is present', () => {
    expect(executeFromItem(executeItem({ outputText: 'static output' }), ctx(null))).toMatchObject({
      command: 'echo ok',
      outputText: 'static output',
    });
  });

  it('prefers live terminal output over stale tool output', () => {
    expect(
      executeFromItem(
        executeItem({ terminalId: 'term-1', outputText: 'stale output' }),
        ctx('live output')
      )
    ).toMatchObject({
      outputText: 'live output',
      terminalId: 'term-1',
    });
  });

  it('falls back to static outputText when terminal output is unavailable', () => {
    expect(
      executeFromItem(
        executeItem({ terminalId: 'term-1', outputText: 'static fallback' }),
        ctx(null)
      )
    ).toMatchObject({
      outputText: 'static fallback',
      terminalId: 'term-1',
    });
  });
});
