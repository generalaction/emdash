import { describe, expect, it } from 'vitest';
import { isAutomationTaskRunning } from './automation-run-stop';

describe('automation run stop availability', () => {
  it.each(['working', 'awaiting-input'] as const)(
    'allows stopping a task whose agent is %s',
    (status) => {
      expect(isAutomationTaskRunning(status)).toBe(true);
    }
  );

  it.each(['idle', 'completed', 'error', null] as const)(
    'does not stop a task whose agent status is %s',
    (status) => {
      expect(isAutomationTaskRunning(status)).toBe(false);
    }
  );
});
