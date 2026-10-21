import { describe, expect, it } from 'vitest';
import type { ToolNode, ToolStatus } from '@/model';
import { deriveToolHeaderState, type ToolHeaderState } from './tool-header-state';

function execute(id: string, status: ToolStatus = 'done'): ToolNode {
  return {
    kind: 'execute-tool-call',
    id,
    seq: 0,
    toolCallId: id,
    title: id,
    command: id,
    status,
  };
}

function group(id: string, children: ToolNode[], status: ToolStatus = 'running'): ToolNode {
  return {
    kind: 'tool-group',
    id,
    seq: 0,
    label: 'Tool run',
    groupKind: 'tool-run',
    status,
    children,
  };
}

function deriveTree(node: ToolNode, pendingIds: ReadonlySet<string>): ToolHeaderState {
  const children = 'children' in node ? (node.children ?? []) : [];
  return deriveToolHeaderState(
    node,
    children.map((child) => deriveTree(child, pendingIds)),
    pendingIds
  );
}

describe('deriveToolHeaderState', () => {
  it('shows permission without activity when every running child is blocked', () => {
    const state = deriveTree(
      group('g', [execute('done'), execute('blocked', 'running')]),
      new Set(['blocked'])
    );

    expect(state).toEqual({
      active: false,
      awaitingPermission: true,
      error: false,
    });
  });

  it('keeps activity independent when another child is still running', () => {
    const state = deriveTree(
      group('g', [execute('active', 'running'), execute('blocked', 'running')]),
      new Set(['blocked'])
    );

    expect(state).toEqual({
      active: true,
      awaitingPermission: true,
      error: false,
    });
  });

  it('keeps failure independent when another child is still running', () => {
    const state = deriveTree(
      group('g', [execute('failed', 'error'), execute('active', 'running')]),
      new Set()
    );

    expect(state).toEqual({
      active: true,
      awaitingPermission: false,
      error: true,
      errorTitle: 'A tool in this group failed',
    });
  });

  it('aggregates actionable state through nested tool groups', () => {
    const nested = group('nested', [execute('blocked', 'running')]);
    const state = deriveTree(group('outer', [execute('done'), nested]), new Set(['blocked']));

    expect(state).toEqual({
      active: false,
      awaitingPermission: true,
      error: false,
    });
  });
});
