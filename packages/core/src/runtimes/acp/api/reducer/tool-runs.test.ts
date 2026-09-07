import { describe, expect, it } from 'vitest';
import type { ToolNode } from '../models/turns/tool-calls';
import type { ToolStatus } from '../models/turns/tools';
import { toolRunLabel, wrapToolRuns } from './tool-runs';

function execute(id: string, seq: number, status: ToolStatus = 'done'): ToolNode {
  return { kind: 'execute-tool-call', id, seq, toolCallId: id, title: 'ls', command: 'ls', status };
}
function read(id: string, seq: number, status: ToolStatus = 'done'): ToolNode {
  return { kind: 'read-tool-call', id, seq, toolCallId: id, title: 'Read a.ts', status };
}
function mcp(id: string, seq: number, status: ToolStatus = 'done'): ToolNode {
  return { kind: 'mcp-tool-call', id, seq, toolCallId: id, title: 'nav', tool: 'nav', status };
}
function search(id: string, seq: number): ToolNode {
  return {
    kind: 'search-tool-call',
    id,
    seq,
    toolCallId: id,
    title: 'foo',
    query: 'foo',
    status: 'done',
  };
}
function fetch(id: string, seq: number): ToolNode {
  return {
    kind: 'web-fetch-tool-call',
    id,
    seq,
    toolCallId: id,
    title: 'u',
    url: 'u',
    status: 'done',
  };
}
function unknown(id: string, seq: number): ToolNode {
  return {
    kind: 'unknown-tool-call',
    id,
    seq,
    toolCallId: id,
    title: 'x',
    toolKind: null,
    name: 'x',
    status: 'done',
  };
}
function edit(id: string, seq: number): ToolNode {
  return {
    kind: 'modify-file-tool-call',
    id,
    seq,
    toolCallId: id,
    title: 'Edit',
    path: 'a.ts',
    oldText: 'a',
    newText: 'b',
    status: 'done',
  };
}
function subagent(id: string, seq: number): ToolNode {
  return {
    kind: 'spawn-subagent-tool-call',
    id,
    seq,
    toolCallId: id,
    title: 'Agent',
    name: 'Agent',
    status: 'done',
  };
}

describe('wrapToolRuns', () => {
  it('folds two or more contiguous groupable calls into one tool-run group', () => {
    const out = wrapToolRuns([execute('e1', 0), mcp('m1', 1), execute('e2', 2)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'tool-group',
      id: 'e1:group',
      seq: 0,
      groupKind: 'tool-run',
      label: 'Ran 2 commands, used a tool',
      status: 'done',
      children: [{ id: 'e1' }, { id: 'm1' }, { id: 'e2' }],
    });
  });

  it('leaves a lone call as is', () => {
    const only = execute('e1', 0);
    expect(wrapToolRuns([only])).toEqual([only]);
  });

  it('keeps read-only runs on the read-batch kind', () => {
    const out = wrapToolRuns([read('r1', 0), read('r2', 1)]);
    expect(out[0]).toMatchObject({ groupKind: 'read-batch', label: 'Read 2 files' });
  });

  it('never folds edits or subagents, and they break a run', () => {
    const out = wrapToolRuns([
      execute('e1', 0),
      execute('e2', 1),
      edit('d1', 2),
      execute('e3', 3),
      subagent('s1', 4),
      execute('e4', 5),
    ]);
    expect(
      out.map((n) => (n.kind === 'tool-group' ? `group(${n.children.length})` : n.id))
    ).toEqual(['group(2)', 'd1', 'e3', 's1', 'e4']);
  });

  it('does not touch consecutive edits', () => {
    const items = [edit('d1', 0), edit('d2', 1)];
    expect(wrapToolRuns(items)).toEqual(items);
  });

  it('reports running while any child runs, otherwise error if any failed', () => {
    expect(wrapToolRuns([execute('e1', 0), execute('e2', 1, 'running')])[0]).toMatchObject({
      status: 'running',
    });
    expect(wrapToolRuns([execute('e1', 0, 'error'), execute('e2', 1)])[0]).toMatchObject({
      status: 'error',
    });
  });

  it('passes non-tool items through untouched', () => {
    const message = { kind: 'message', id: 'm', seq: 0 } as unknown as ToolNode;
    const out = wrapToolRuns([message, execute('e1', 1), execute('e2', 2)]);
    expect(out[0]).toBe(message);
    expect(out[1]).toMatchObject({ kind: 'tool-group' });
  });
});

describe('toolRunLabel', () => {
  it('uses singular and plural forms per kind', () => {
    expect(toolRunLabel([execute('e', 0)])).toBe('Ran a command');
    expect(toolRunLabel([read('r', 0)])).toBe('Read a file');
    expect(toolRunLabel([search('s', 0), search('s2', 1)])).toBe('Ran 2 searches');
    expect(toolRunLabel([mcp('m', 0), fetch('f', 1), unknown('u', 2)])).toBe('Used 3 tools');
  });

  it('orders phrases commands, files, searches, tools and lowercases the rest', () => {
    expect(toolRunLabel([mcp('m', 0), read('r', 1), execute('e', 2), search('s', 3)])).toBe(
      'Ran a command, read a file, ran a search, used a tool'
    );
  });
});
