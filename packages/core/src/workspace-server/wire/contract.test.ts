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
});
