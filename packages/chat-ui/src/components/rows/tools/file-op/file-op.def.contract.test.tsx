import type { SegmentCtx } from '@core/units';
import { describe, expect, it } from 'vitest';
import type { ToolNode } from '@/model';
import { readFileOpFromItem } from './file-op.def';

const ctx = {
  pendingToolCallIds: () => new Set<string>(),
} as SegmentCtx;

function readItem(overrides: Partial<Extract<ToolNode, { kind: 'read-tool-call' }>> = {}) {
  return {
    kind: 'read-tool-call',
    id: 'read-1',
    seq: 0,
    toolCallId: 'call-1',
    title: 'Read File',
    status: 'done',
    locations: [],
    ...overrides,
  } satisfies Extract<ToolNode, { kind: 'read-tool-call' }>;
}

describe('readFileOpFromItem', () => {
  it('projects every structured ACP location, including line numbers', () => {
    expect(
      readFileOpFromItem(
        readItem({
          locations: [{ path: '/workspace/a.ts', line: 7 }, { path: '/workspace/b.ts' }],
        }),
        ctx
      )
    ).toMatchObject({
      ops: [{ path: '/workspace/a.ts', line: 7 }, { path: '/workspace/b.ts' }],
    });
  });

  it('has no file operations when structured locations are absent', () => {
    expect(readFileOpFromItem(readItem({ locations: undefined }), ctx)).toMatchObject({ ops: [] });
  });
});
