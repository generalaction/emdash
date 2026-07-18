import type { SegmentCtx } from '@core/units';
import { describe, expect, it } from 'vitest';
import type { ToolNode } from '@/model';
import { toolFromItem } from './tool.def';

function searchItem(query: string) {
  return {
    kind: 'search-tool-call',
    id: 'search-1',
    seq: 0,
    toolCallId: 'call-1',
    title: 'Search',
    status: 'done',
    query,
  } satisfies Extract<ToolNode, { kind: 'search-tool-call' }>;
}

const ctx = {
  pendingToolCallIds: () => new Set<string>(),
} as SegmentCtx;

describe('toolFromItem', () => {
  it('removes a redundant Search prefix from search summaries', () => {
    expect(toolFromItem(searchItem("Search for 'toAgentUpdate'"), ctx)).toMatchObject({
      name: 'Search',
      inputSummary: "for 'toAgentUpdate'",
    });
  });

  it('preserves search summaries without the redundant prefix', () => {
    expect(toolFromItem(searchItem('SolidJS virtualized list patterns'), ctx)).toMatchObject({
      name: 'Search',
      inputSummary: 'SolidJS virtualized list patterns',
    });
  });
});
