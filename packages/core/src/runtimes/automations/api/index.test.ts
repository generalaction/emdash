import { describe, expect, it } from 'vitest';
import * as automations from './index';

describe('@emdash/core/runtimes/automations/api public exports', () => {
  it('exports the Wire contract and portable schemas', () => {
    const exported = automations as Record<string, unknown>;

    expect(exported.automationsContract).toBeTypeOf('object');
    expect(exported.automationDeploymentSchema).toBeTypeOf('object');
    expect(exported.automationWorkspaceTargetSchema).toBeTypeOf('object');
    expect(exported.automationRunConfigSnapshotSchema).toBeTypeOf('object');
    expect(exported.automationRunSchema).toBeTypeOf('object');
    expect(exported.getRunsInputSchema).toBeTypeOf('object');
    expect(exported.runEventsKeySchema).toBeTypeOf('object');
    expect(exported.deployErrorSchema).toBeTypeOf('object');
    expect(automations.automationsContract.deploy.kind).toBe('procedure');
    expect(automations.automationsContract.remove.kind).toBe('procedure');
    expect(automations.automationsContract.startRun.kind).toBe('procedure');
    expect(automations.automationsContract.stopRun.kind).toBe('procedure');
    expect(automations.automationsContract.getRuns.kind).toBe('procedure');
    expect(automations.automationsContract.runEvents.kind).toBe('eventStream');
  });

  it('does not expose host runtime values', () => {
    const exported = automations as Record<string, unknown>;

    expect(exported.AutomationsRuntime).toBeUndefined();
    expect(exported.SqliteAutomationsStore).toBeUndefined();
  });
});
