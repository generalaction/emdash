import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import { step } from '@runtimes/workspace/api/provisioning';
import { provisionWorkspaceInputSchema } from '@runtimes/workspace/api/schemas';
import { describe, expect, it } from 'vitest';
import { workspaceWireContract } from './contract';

describe('workspaceWireContract', () => {
  it('mounts the ACP contract under the acp domain without changing protocol shape elsewhere', () => {
    expect(workspaceWireContract.acp.startSession.kind).toBe('procedure');
    expect(workspaceWireContract.acp.sessions.kind).toBe('liveModel');
    expect(workspaceWireContract.acp.sessions.id).toBe('acp.sessions');
    expect(workspaceWireContract.acp.terminalOutput.kind).toBe('liveLog');
    expect(workspaceWireContract.acp.terminalOutput.id).toBe('acp.terminalOutput');
  });

  it('mounts TUI agents under the tuiAgents domain', () => {
    expect(workspaceWireContract.tuiAgents.startSession.kind).toBe('procedure');
    expect(workspaceWireContract.tuiAgents.resumeSession.kind).toBe('procedure');
    expect(workspaceWireContract.tuiAgents.output.kind).toBe('liveLog');
    expect(workspaceWireContract.tuiAgents.output.id).toBe('tuiAgents.output');
    expect(workspaceWireContract.tuiAgents.sessions.kind).toBe('liveModel');
    expect(workspaceWireContract.tuiAgents.sessions.id).toBe('tuiAgents.sessions');
    expect(workspaceWireContract.tuiAgents.notifications.kind).toBe('liveModel');
    expect(workspaceWireContract.tuiAgents.notifications.id).toBe('tuiAgents.notifications');
  });

  it('mounts the workspace runtime under the workspace domain', () => {
    expect(workspaceWireContract.workspace.workspace.kind).toBe('liveModel');
    expect(workspaceWireContract.workspace.workspace.id).toBe('workspace.workspace');
    expect(workspaceWireContract.workspace.activate.kind).toBe('liveJob');
    expect(workspaceWireContract.workspace.deactivate.kind).toBe('liveJob');
    expect(workspaceWireContract.workspace.teardown.kind).toBe('liveJob');
  });

  it('mounts port forwards under the portForwards domain', () => {
    expect(workspaceWireContract.portForwards.inspect.kind).toBe('procedure');
  });

  it('keeps provisioning input shapes compatible after schema relocation', () => {
    const parsedPath = parseAbsolute('/tmp/emdash-workspace');
    expect(parsedPath.success).toBe(true);
    if (!parsedPath.success) throw new Error('expected test path to parse');

    expect(
      provisionWorkspaceInputSchema.safeParse({
        workspace: hostFileRef(LOCAL_HOST_REF, parsedPath.data),
        lifecycle: {
          ref: {
            kind: 'directory',
            path: '/tmp/emdash-workspace',
            setupConfigHash: 'hash-a',
          },
          context: {
            repoPath: '/tmp/emdash-repo',
            preservePatterns: ['.env.local'],
          },
          setupPlan: {
            steps: [
              {
                id: 'run-script:1',
                label: 'Run setup',
                step: step('run-script', {
                  id: 'setup',
                  command: 'pnpm install',
                  cwd: 'worktree',
                }),
              },
            ],
          },
        },
      }).success
    ).toBe(true);
  });
});
