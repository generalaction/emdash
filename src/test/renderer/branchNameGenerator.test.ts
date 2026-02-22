import { describe, it, expect } from 'vitest';
import { generateTaskName } from '../../renderer/lib/branchNameGenerator';

describe('generateTaskName', () => {
  it('generates a slug from a task description', () => {
    const result = generateTaskName('Fix the login page crash on mobile Safari');
    expect(result).toBeTruthy();
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('generates a slug from issue content', () => {
    const result = generateTaskName('Auth token refresh fails after session timeout');
    expect(result).toBeTruthy();
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('returns empty string for empty input', () => {
    const result = generateTaskName('');
    expect(result).toBe('');
  });

  it('returns empty string for slash commands', () => {
    expect(generateTaskName('/model')).toBe('');
    expect(generateTaskName('/help')).toBe('');
    expect(generateTaskName('/context')).toBe('');
  });

  it('returns empty string for very short input', () => {
    expect(generateTaskName('y')).toBe('');
    expect(generateTaskName('ok')).toBe('');
    expect(generateTaskName('no')).toBe('');
  });

  it('returns empty string for single-word short input', () => {
    expect(generateTaskName('debugging')).toBe('');
    expect(generateTaskName('refactor')).toBe('');
  });

  it('truncates to MAX_TASK_NAME_LENGTH', () => {
    const longDescription =
      'Fix the extremely long and verbose description that goes on and on about many different things that are broken in the authentication system';
    const result = generateTaskName(longDescription);
    expect(result.length).toBeLessThanOrEqual(64);
  });
});
