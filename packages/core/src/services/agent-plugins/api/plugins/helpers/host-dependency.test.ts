import { describe, expect, it } from 'vitest';
import { homebrewOption, npmDependency } from './host-dependency';

describe('homebrewOption', () => {
  it('is retained as a deprecated no-op helper for legacy plugin definitions', () => {
    const opt = homebrewOption({ formula: 'myapp', recommended: true });
    expect(opt).toEqual({});
  });
});

describe('npmDependency', () => {
  const base = { id: 'mytool', package: '@acme/mytool' };

  it('defaults binaryNames to [id]', () => {
    const dep = npmDependency(base);
    expect(dep.binaryNames).toEqual(['mytool']);
  });

  it('respects explicit binaryNames override', () => {
    const dep = npmDependency({ ...base, binaryNames: ['bin1', 'bin2'] });
    expect(dep.binaryNames).toEqual(['bin1', 'bin2']);
  });

  it('carries installDocs when provided', () => {
    const dep = npmDependency({ ...base, installDocs: 'https://example.com/docs' });
    expect(dep.installDocs).toBe('https://example.com/docs');
  });

  it('omits installDocs when not provided', () => {
    const dep = npmDependency(base);
    expect('installDocs' in dep).toBe(false);
  });

  it('carries an optional self-update command', () => {
    const dep = npmDependency({
      ...base,
      updateCommand: { kind: 'self', args: ['upgrade'] },
    });
    expect(dep.updateCommand).toEqual({ kind: 'self', args: ['upgrade'] });
  });
});
