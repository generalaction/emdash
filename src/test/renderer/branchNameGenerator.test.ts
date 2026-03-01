import { describe, expect, it } from 'vitest';
import { generateTaskName } from '../../renderer/lib/branchNameGenerator';

describe('generateTaskName', () => {
  it('generates a slug from a descriptive prompt', () => {
    const result = generateTaskName('Fix the login page on mobile devices');
    expect(result).toBeTruthy();
    expect(result).toMatch(/^[a-z0-9-]+$/);
    expect(result!.length).toBeLessThanOrEqual(64);
  });

  it('returns null for slash commands', () => {
    expect(generateTaskName('/help')).toBeNull();
    expect(generateTaskName('/status')).toBeNull();
  });

  it('returns null for very short inputs', () => {
    expect(generateTaskName('hi')).toBeNull();
    expect(generateTaskName('fix')).toBeNull();
    expect(generateTaskName('ok')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(generateTaskName('')).toBeNull();
    expect(generateTaskName('   ')).toBeNull();
  });

  it('limits output to 64 characters', () => {
    const longInput =
      'Refactor the entire authentication system to use JWT tokens with refresh token rotation and implement proper session management across all microservices';
    const result = generateTaskName(longInput);
    expect(result).toBeTruthy();
    expect(result!.length).toBeLessThanOrEqual(64);
  });

  it('produces different names for different inputs', () => {
    const a = generateTaskName('Fix the login page on mobile devices');
    const b = generateTaskName('Add user authentication with JWT tokens');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toEqual(b);
  });

  it('contains only valid slug characters', () => {
    const result = generateTaskName('Handle special chars: @#$% and unicode');
    if (result) {
      expect(result).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
