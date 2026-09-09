import { describe, expect, it } from 'vitest';
import {
  comparisonKeyForAbsolutePath,
  createPathSemantics,
  nativePathIdentityKey,
  parseAbsolute,
  stableNativePathDisplay,
} from './index';

describe('path semantics', () => {
  it('compares paths using explicit case sensitivity', () => {
    const upper = parseAbsolute('/Repo/Src.ts', { profile: { style: 'posix' } });
    const lower = parseAbsolute('/repo/src.ts', { profile: { style: 'posix' } });
    expect(upper.success && lower.success).toBe(true);
    if (!upper.success || !lower.success) return;

    expect(createPathSemantics({ style: 'posix' }).equals(upper.data, lower.data)).toBe(false);
    expect(
      createPathSemantics({ style: 'posix', caseSensitivity: 'insensitive' }).equals(
        upper.data,
        lower.data
      )
    ).toBe(true);
  });

  it('normalizes Unicode for comparison keys when requested', () => {
    const composed = parseAbsolute('/repo/é.ts', { profile: { style: 'posix' } });
    const decomposed = parseAbsolute('/repo/e\u0301.ts', { profile: { style: 'posix' } });
    expect(composed.success && decomposed.success).toBe(true);
    if (!composed.success || !decomposed.success) return;

    const semantics = createPathSemantics({ style: 'posix', unicodeNormalization: 'nfc' });
    expect(semantics.comparisonKey(composed.data)).toBe(semantics.comparisonKey(decomposed.data));
  });

  it('checks containment through semantic comparison keys', () => {
    const root = parseAbsolute('C:/Repo', { profile: { style: 'win32' } });
    const child = parseAbsolute('c:/repo/src/index.ts', { profile: { style: 'win32' } });
    expect(root.success && child.success).toBe(true);
    if (!root.success || !child.success) return;

    expect(createPathSemantics({ style: 'win32' }).contains(root.data, child.data)).toBe(true);
  });

  it('infers Win32 identity from structured drive and UNC roots', () => {
    const upperDrive = parseAbsolute('C:/Repo/Src.ts', { profile: { style: 'win32' } });
    const lowerDrive = parseAbsolute('c:/repo/src.ts', { profile: { style: 'win32' } });
    expect(upperDrive.success && lowerDrive.success).toBe(true);
    if (!upperDrive.success || !lowerDrive.success) return;

    expect(comparisonKeyForAbsolutePath(upperDrive.data)).toBe(
      comparisonKeyForAbsolutePath(lowerDrive.data)
    );
    expect(nativePathIdentityKey('\\\\SERVER\\Share\\Repo')).toBe(
      nativePathIdentityKey('\\\\server\\share\\repo')
    );
  });

  it('keeps inferred POSIX identity case-sensitive', () => {
    expect(nativePathIdentityKey('/Repo')).not.toBe(nativePathIdentityKey('/repo'));
  });

  it('keeps canonical display casing but replaces legacy non-canonical spelling', () => {
    expect(stableNativePathDisplay('C:\\Repo', 'c:\\REPO')).toBe('C:\\Repo');
    expect(stableNativePathDisplay('/repo/../repo', '/repo')).toBe('/repo');
  });

  it('contains descendants of filesystem roots', () => {
    const root = parseAbsolute('/', { profile: { style: 'posix' } });
    const child = parseAbsolute('/repo/index.ts', { profile: { style: 'posix' } });
    expect(root.success && child.success).toBe(true);
    if (!root.success || !child.success) return;

    expect(createPathSemantics({ style: 'posix' }).contains(root.data, child.data)).toBe(true);
  });
});
