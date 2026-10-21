import { describe, expect, it } from 'vitest';
import { automationsContract } from './contract';

describe('automationsContract', () => {
  it('validates definition inputs with concrete schemas', () => {
    expect(
      automationsContract.create.input.safeParse({
        name: 'Review changes',
        projectId: 'project-1',
        triggerConfig: { expr: '0 9 * * *' },
        conversationConfig: {
          prompt: 'Review changes',
          provider: 'claude',
          autoApprove: false,
        },
      }).success
    ).toBe(true);
    expect(
      automationsContract.create.input.safeParse({
        name: 'Review changes',
        projectId: 'project-1',
      }).success
    ).toBe(false);
  });

  it('validates typed definition and adoption failures', () => {
    expect(
      automationsContract.update.output.safeParse({
        success: false,
        error: {
          type: 'automation-conflict',
          automationId: 'automation-1',
          message: 'Conflict',
        },
      }).success
    ).toBe(true);
    expect(
      automationsContract.adoptRun.output.safeParse({
        success: false,
        error: { type: 'run-not-found', runId: 'run-1', message: 'Missing' },
      }).success
    ).toBe(true);
    expect(
      automationsContract.adoptRun.output.safeParse({
        success: false,
        error: { type: 'run-not-found', message: 'Missing' },
      }).success
    ).toBe(false);
  });

  it('requires projectId and automationId when subscribing to run events', () => {
    expect(automationsContract.runEvents.keySchema.safeParse({}).success).toBe(false);
    expect(
      automationsContract.runEvents.keySchema.safeParse({ automationId: 'automation-1' }).success
    ).toBe(false);
    expect(
      automationsContract.runEvents.keySchema.safeParse({
        projectId: 'project-1',
        automationId: 'automation-1',
      }).success
    ).toBe(true);
  });
});
