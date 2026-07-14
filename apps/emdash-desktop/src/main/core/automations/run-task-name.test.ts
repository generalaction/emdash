import { describe, expect, it } from 'vitest';
import type { Automation } from '@shared/core/automations/automation';
import { runTaskNameBase } from './run-task-name';

function automationNamed(name: string): Automation {
  return { id: 'a-1', name, enabled: true, createdAt: 0, updatedAt: 0 };
}

describe('runTaskNameBase', () => {
  it('slugifies the automation name', () => {
    expect(runTaskNameBase(automationNamed('Find critical bugs'))).toBe('find-critical-bugs');
  });

  it('strips characters that are invalid in task and branch names', () => {
    expect(runTaskNameBase(automationNamed('Auto-read ⭐ star count!!'))).toBe(
      'auto-read-star-count'
    );
  });

  it('truncates long names without leaving a trailing dash', () => {
    const base = runTaskNameBase(automationNamed(`${'a'.repeat(57)} bcd`));
    expect(base).toBe('a'.repeat(57));
    expect(base.length).toBeLessThanOrEqual(58);
  });

  it('falls back to a random name when the automation name has no usable characters', () => {
    const base = runTaskNameBase(automationNamed('⭐⭐'));
    expect(base.length).toBeGreaterThan(0);
    expect(base).toMatch(/^[a-z0-9-]+$/);
  });
});
