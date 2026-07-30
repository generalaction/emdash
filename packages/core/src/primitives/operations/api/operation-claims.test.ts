import { describe, expect, it } from 'vitest';
import { operationClaimResourceKey } from './operation-claims';

describe('operationClaimResourceKey', () => {
  it('keeps simple resource ids readable', () => {
    expect(operationClaimResourceKey({ kind: 'project', id: 'project-1' })).toBe(
      'project:project-1'
    );
    expect(operationClaimResourceKey({ kind: 'task', id: 'task-1' })).toBe('task:task-1');
    expect(operationClaimResourceKey({ kind: 'workspace', id: 'workspace-1' })).toBe(
      'workspace:workspace-1'
    );
    expect(operationClaimResourceKey({ kind: 'automation', id: 'automation-1' })).toBe(
      'automation:automation-1'
    );
  });

  it('escapes delimiters in compound resource keys', () => {
    expect(
      operationClaimResourceKey({ kind: 'branch', projectId: 'project:1', name: 'feat/a:b' })
    ).toBe('branch:project%3A1:feat%2Fa%3Ab');
    expect(
      operationClaimResourceKey({ kind: 'worktree', hostRef: 'remote:1', path: '/repo/a:b' })
    ).toBe('worktree:remote%3A1:%2Frepo%2Fa%3Ab');
  });
});
