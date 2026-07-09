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
});
