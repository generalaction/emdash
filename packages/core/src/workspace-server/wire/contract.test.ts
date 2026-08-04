import { describe, expect, it } from 'vitest';
import { workspaceWireContract } from './contract';

describe('workspaceWireContract', () => {
  it('mounts every worker-backed runtime expected by the aggregate controller', () => {
    expect(workspaceWireContract.automations.deploy.kind).toBe('procedure');
    expect(workspaceWireContract.fileSearch.searchContent.kind).toBe('liveJob');
    expect(workspaceWireContract.terminals.startTerminal.kind).toBe('procedure');
  });

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
    expect(workspaceWireContract.tuiAgents.agentStates.kind).toBe('liveModel');
    expect(workspaceWireContract.tuiAgents.agentStates.id).toBe('tuiAgents.agentStates');
  });

  it('mounts workspace-host operations, initialization, and notices', () => {
    expect(workspaceWireContract.workspaceHost.submitOperation.kind).toBe('procedure');
    expect(workspaceWireContract.workspaceHost.operations.kind).toBe('liveModel');
    expect(workspaceWireContract.workspaceHost.operations.id).toBe('workspaceHost.operations');
    expect(workspaceWireContract.workspaceHost.initializeWorkspace.kind).toBe('procedure');
    expect(workspaceWireContract.workspaceHost.runWorkspaceScript.kind).toBe('procedure');
    expect(workspaceWireContract.workspaceHost.measureUsage.kind).toBe('procedure');
    expect(workspaceWireContract.workspaceHost.notices.kind).toBe('liveModel');
    expect(workspaceWireContract.workspaceHost.notices.id).toBe('workspaceHost.notices');
  });

  it('does not mount the retired legacy workspace runtime', () => {
    expect('workspace' in workspaceWireContract).toBe(false);
  });

  it('mounts port forwards under the portForwards domain', () => {
    expect(workspaceWireContract.portForwards.inspect.kind).toBe('procedure');
  });
});
