import { describe, expect, it } from 'vitest';
import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';
import { compileDeleteWorkspacePlan } from './delete-workspace-plan';
import type { WorkspaceOperationProbe } from './probe-workspace-state';

const operation: LifecycleOperationRow = {
  id: 'operation-1',
  kind: 'delete-workspace',
  status: 'pending',
  projectId: 'project-1',
  taskId: null,
  workspaceId: 'workspace-1',
  entityKey: 'workspace-1',
  hostRef: 'local',
  payload: { version: '1', source: 'user' },
  attempt: 0,
  error: null,
  createdAt: 1,
  finishedAt: null,
};

function probe(values: Partial<WorkspaceOperationProbe> = {}): WorkspaceOperationProbe {
  return {
    inUse: false,
    sessionTargets: {
      acpConversationIds: [],
      tuiConversationIds: [],
      terminalSessionIds: [],
      tmuxSessionNames: [],
    },
    context: { preservePatterns: [] },
    ...values,
  };
}

describe('compileDeleteWorkspacePlan', () => {
  it('kills every session family before removing the workspace', () => {
    const plan = compileDeleteWorkspacePlan(
      probe({
        sessionTargets: {
          acpConversationIds: ['acp-1'],
          tuiConversationIds: ['tui-1'],
          terminalSessionIds: ['terminal-1'],
          tmuxSessionNames: ['tmux-1'],
        },
      }),
      operation
    );

    if (!plan.steps) throw new Error('expected an executable plan');
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'kill-acp-sessions',
      'kill-tui-sessions',
      'teardown-workspace',
      'purge-workspace-row',
    ]);
  });

  it('fails its precondition without compiling destructive steps when in use', () => {
    const plan = compileDeleteWorkspacePlan(probe({ inUse: true }), operation);

    expect('steps' in plan).toBe(false);
    if (!plan.preconditionFailure) throw new Error('expected a precondition failure');
    expect(plan.preconditionFailure.type).toBe('workspace-in-use');
  });
});
