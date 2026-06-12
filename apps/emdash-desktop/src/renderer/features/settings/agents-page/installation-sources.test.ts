import { describe, expect, it } from 'vitest';
import type { Installation, InstallOption } from '@shared/core/agents/agent-payload';
import {
  buildSourceRows,
  findInstallation,
  installIdOf,
  refFromUsed,
  toSelection,
} from './installation-sources';

const makeInstall = (id: string, status: 'available' | 'missing' = 'available'): Installation => ({
  id,
  source:
    id === 'path'
      ? { kind: 'path', path: '/usr/bin/tool' }
      : id === 'cli'
        ? { kind: 'cli', command: 'tool' }
        : id === 'auto'
          ? { kind: 'cli', command: 'tool' }
          : { kind: 'method', method: id.replace('method:', '') as never },
  status,
  path: status === 'available' ? '/usr/bin/tool' : null,
  version: status === 'available' ? '1.0.0' : null,
  latestVersion: null,
  updateAvailable: false,
});

const installOptions: InstallOption[] = [
  { method: 'npm', command: 'npm install -g mytool', recommended: true },
  { method: 'homebrew', command: 'brew install mytool' },
];

describe('installIdOf', () => {
  it('returns auto for auto ref', () => expect(installIdOf({ kind: 'auto' })).toBe('auto'));
  it('returns method:<m> for method ref', () =>
    expect(installIdOf({ kind: 'method', method: 'npm' })).toBe('method:npm'));
  it('returns path for path ref', () => expect(installIdOf({ kind: 'path' })).toBe('path'));
  it('returns cli for cli ref', () => expect(installIdOf({ kind: 'cli' })).toBe('cli'));
});

describe('findInstallation', () => {
  const installs = [makeInstall('auto'), makeInstall('method:npm'), makeInstall('path', 'missing')];

  it('finds by auto ref', () => {
    expect(findInstallation(installs, { kind: 'auto' })?.id).toBe('auto');
  });

  it('finds by method ref', () => {
    expect(findInstallation(installs, { kind: 'method', method: 'npm' })?.id).toBe('method:npm');
  });

  it('returns undefined for missing cli ref', () => {
    expect(findInstallation(installs, { kind: 'cli' })).toBeUndefined();
  });
});

describe('toSelection', () => {
  it('builds path selection', () => {
    expect(toSelection({ kind: 'path' }, { path: '/usr/bin/foo' })).toEqual({
      usedId: 'path',
      path: '/usr/bin/foo',
    });
  });

  it('builds cli selection', () => {
    expect(toSelection({ kind: 'cli' }, { cli: 'foo' })).toEqual({
      usedId: 'cli',
      cli: 'foo',
    });
  });

  it('builds method selection', () => {
    expect(toSelection({ kind: 'method', method: 'npm' })).toEqual({ usedId: 'method:npm' });
  });

  it('builds auto selection', () => {
    expect(toSelection({ kind: 'auto' })).toEqual({ usedId: 'auto' });
  });
});

describe('buildSourceRows', () => {
  it('includes auto as the first row', () => {
    const rows = buildSourceRows(installOptions, []);
    expect(rows[0]?.ref.kind).toBe('auto');
  });

  it('includes all install option methods in order', () => {
    const rows = buildSourceRows(installOptions, []);
    const kinds = rows.map((r) => r.ref.kind);
    expect(kinds).toContain('method');
    const methodRows = rows.filter((r) => r.ref.kind === 'method');
    expect(methodRows.map((r) => r.ref.kind === 'method' && r.ref.method)).toEqual([
      'npm',
      'homebrew',
    ]);
  });

  it('always appends path and cli override rows', () => {
    const rows = buildSourceRows(installOptions, []);
    const refs = rows.map((r) => r.ref.kind);
    expect(refs).toContain('path');
    expect(refs).toContain('cli');
  });

  it('reflects available status from detected installations', () => {
    const installs = [makeInstall('method:npm', 'available'), makeInstall('auto', 'missing')];
    const rows = buildSourceRows(installOptions, installs);
    const npmRow = rows.find((r) => r.ref.kind === 'method' && r.ref.method === 'npm');
    const autoRow = rows.find((r) => r.ref.kind === 'auto');
    expect(npmRow?.status).toBe('available');
    expect(autoRow?.status).toBe('missing');
  });

  it('marks method as missing when not in installations', () => {
    const rows = buildSourceRows(installOptions, []);
    const homebrewRow = rows.find((r) => r.ref.kind === 'method' && r.ref.method === 'homebrew');
    expect(homebrewRow?.status).toBe('missing');
  });

  it('marks npm as recommended', () => {
    const rows = buildSourceRows(installOptions, []);
    const npmRow = rows.find((r) => r.ref.kind === 'method' && r.ref.method === 'npm');
    expect(npmRow?.recommended).toBe(true);
  });
});

describe('refFromUsed', () => {
  it('returns auto when used is undefined', () => {
    expect(refFromUsed(undefined)).toEqual({ kind: 'auto' });
  });

  it('returns auto for auto installation', () => {
    expect(refFromUsed(makeInstall('auto'))).toEqual({ kind: 'auto' });
  });

  it('returns method ref for method installation', () => {
    expect(refFromUsed(makeInstall('method:npm'))).toEqual({ kind: 'method', method: 'npm' });
  });

  it('returns path ref for path installation', () => {
    expect(refFromUsed(makeInstall('path'))).toEqual({ kind: 'path' });
  });

  it('returns cli ref for cli installation', () => {
    expect(refFromUsed(makeInstall('cli'))).toEqual({ kind: 'cli' });
  });
});
