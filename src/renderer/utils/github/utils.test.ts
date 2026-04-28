import { describe, expect, it } from 'vitest';
import { extractOwner } from './utils';

describe('extractOwner', () => {
  it('extracts owner from normalized HTTPS URL', () => {
    expect(extractOwner('https://github.com/myuser/repo')).toBe('myuser');
  });

  it('extracts owner from HTTPS URL with .git suffix', () => {
    expect(extractOwner('https://github.com/myuser/repo.git')).toBe('myuser');
  });

  it('extracts owner from SSH URL', () => {
    expect(extractOwner('git@github.com:myuser/repo.git')).toBe('myuser');
  });

  it('extracts owner from explicit SSH URL', () => {
    expect(extractOwner('ssh://git@github.com/myuser/repo.git')).toBe('myuser');
  });

  it('extracts owner from HTTPS URL with query params', () => {
    expect(extractOwner('https://github.com/myuser/repo?foo=bar')).toBe('myuser');
  });

  it('returns null for non-GitHub URLs', () => {
    expect(extractOwner('https://gitlab.com/myuser/repo')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractOwner('')).toBeNull();
  });
});
