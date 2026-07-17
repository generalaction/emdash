import { describe, expect, it } from 'vitest';
import { automationsContract } from './contract';

describe('automationsContract', () => {
  it('requires an automation id when subscribing to run events', () => {
    expect(automationsContract.runEvents.keySchema.safeParse({}).success).toBe(false);
    expect(
      automationsContract.runEvents.keySchema.safeParse({ automationId: 'automation-1' }).success
    ).toBe(true);
  });
});
