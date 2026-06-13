import { describe, expect, it } from 'vitest';
import type {
  Installation,
  InstallOption,
  SelectedSource,
} from '@shared/core/agents/agent-payload';
import { sourceKey } from '@shared/core/agents/agent-payload';
import {
  buildSourceRows,
  findInstallation,
  refFromUsed,
  toSelection,
} from './installation-sources';

const makeInstall = (
  sourceOrId: SelectedSource | string,
  status: 'available' | 'missing' = 'available'
): Installation => {
  const source: SelectedSource =
    typeof sourceOrId === 'string'
      ? sourceOrId === 'auto'
        ? { kind: 'auto' }
        : sourceOrId === 'path'
          ? { kind: 'path', path: '/usr/bin/tool' }
          : sourceOrId === 'cli'
            ? { kind: 'cli', command: 'tool' }
            : sourceOrId.startsWith('method:')
              ? { kind: 'method', method: sourceOrId.replace('method:', '') as never }
              : { kind: 'auto' }
      : sourceOrId;
  return {
    id: sourceKey(source),
    source,
    inferredMethod: null,
    status,
    path: status === 'available' ? '/usr/bin/tool' : null,
    version: status === 'available' ? '1.0.0' : null,
    latestVersion: null,
    updateAvailable: false,
  };
};

const installOptions: InstallOption[] = [
  { method: 'npm', command: 'npm install -g mytool', recommended: true },
  { method: 'homebrew', command: 'brew install mytool' },
];

describe('sourceKey (installIdOf)', () => {
  it('returns auto for auto', () => expect(sourceKey({ kind: 'auto' })).toBe('auto'));
  it('returns method:<m> for method', () =>
    expect(sourceKey({ kind: 'method', method: 'npm' })).toBe('method:npm'));
  it('returns path for path', () =>
    expect(sourceKey({ kind: 'path', path: '/usr/bin/foo' })).toBe('path'));
  it('returns cli for cli', () => expect(sourceKey({ kind: 'cli', command: 'foo' })).toBe('cli'));
});

describe('findInstallation', () => {
  const installs = [
    makeInstall('auto'),
    makeInstall('method:npm'),
    makeInstall({ kind: 'path', path: '/usr/bin/tool' }, 'missing'),
  ];

  it('finds by auto ref', () => {
    expect(findInstallation(installs, { kind: 'auto' })?.id).toBe('auto');
  });

  it('finds by method ref', () => {
    expect(findInstallation(installs, { kind: 'method', method: 'npm' })?.id).toBe('method:npm');
  });

  it('returns undefined for missing cli ref', () => {
    expect(findInstallation(installs, { kind: 'cli', command: 'tool' })).toBeUndefined();
  });
});

describe('toSelection', () => {
  it('builds path selection', () => {
    expect(toSelection({ kind: 'path', path: '' }, { path: '/usr/bin/foo' })).toEqual({
      kind: 'path',
      path: '/usr/bin/foo',
    });
  });

  it('builds cli selection', () => {
    expect(toSelection({ kind: 'cli', command: '' }, { cli: 'foo' })).toEqual({
      kind: 'cli',
      command: 'foo',
    });
  });

  it('builds method selection', () => {
    expect(toSelection({ kind: 'method', method: 'npm' })).toEqual({
      kind: 'method',
      method: 'npm',
    });
  });

  it('returns null for auto (clear override)', () => {
    expect(toSelection({ kind: 'auto' })).toBeNull();
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

  it('reflects available status from method installation in list', () => {
    const installs = [makeInstall('method:npm', 'available'), makeInstall('auto', 'missing')];
    const rows = buildSourceRows(installOptions, installs);
    const npmRow = rows.find((r) => r.ref.kind === 'method' && r.ref.method === 'npm');
    const autoRow = rows.find((r) => r.ref.kind === 'auto');
    expect(npmRow?.status).toBe('available');
    expect(autoRow?.status).toBe('missing');
  });

  it('shows available for method row when auto inferredMethod matches', () => {
    const autoInst: Installation = {
      id: 'auto',
      source: { kind: 'auto' },
      inferredMethod: 'homebrew',
      status: 'available',
      path: '/opt/homebrew/bin/tool',
      version: '1.0.0',
      latestVersion: null,
      updateAvailable: false,
    };
    const rows = buildSourceRows(installOptions, [autoInst]);
    const homebrewRow = rows.find((r) => r.ref.kind === 'method' && r.ref.method === 'homebrew');
    expect(homebrewRow?.status).toBe('available');
  });

  it('marks method as missing when not in installations and inferredMethod does not match', () => {
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

  it('returns auto for auto SelectedSource', () => {
    expect(refFromUsed({ kind: 'auto' })).toEqual({ kind: 'auto' });
  });

  it('returns method ref for method SelectedSource', () => {
    expect(refFromUsed({ kind: 'method', method: 'npm' })).toEqual({
      kind: 'method',
      method: 'npm',
    });
  });

  it('returns path ref for path SelectedSource', () => {
    const pathSrc: SelectedSource = { kind: 'path', path: '/usr/bin/foo' };
    expect(refFromUsed(pathSrc)).toEqual(pathSrc);
  });

  it('returns cli ref for cli SelectedSource', () => {
    const cliSrc: SelectedSource = { kind: 'cli', command: 'foo' };
    expect(refFromUsed(cliSrc)).toEqual(cliSrc);
  });
});

// ---------------------------------------------------------------------------
// seedSource logic — tests use the same primitives to replicate the helper
// behaviour without importing it directly from the React module.
// ---------------------------------------------------------------------------

/** Replicates InstallSection.seedSource logic for unit-testing purposes. */
function seedSource(
  used: SelectedSource | undefined,
  status: string,
  opts: InstallOption[]
): SelectedSource {
  const liveRef = refFromUsed(used);
  if (liveRef.kind !== 'auto') return liveRef;
  if (status !== 'available') {
    const rec = opts.find((o) => o.recommended);
    if (rec) return { kind: 'method', method: rec.method } as SelectedSource;
  }
  return { kind: 'auto' };
}

describe('seedSource (initial selectedSource seeding)', () => {
  const optsWithRecommended: InstallOption[] = [
    { method: 'homebrew', command: 'brew install mytool', recommended: true },
    { method: 'npm', command: 'npm install -g mytool' },
  ];
  const optsNoRecommended: InstallOption[] = [{ method: 'npm', command: 'npm install -g mytool' }];

  it('returns the persisted selection when used is an explicit method', () => {
    const used: SelectedSource = { kind: 'method', method: 'npm' };
    expect(seedSource(used, 'missing', optsWithRecommended)).toEqual(used);
  });

  it('returns the persisted path override regardless of status', () => {
    const used: SelectedSource = { kind: 'path', path: '/custom/tool' };
    expect(seedSource(used, 'available', optsWithRecommended)).toEqual(used);
  });

  it('returns recommended method for uninstalled agents with no prior selection', () => {
    expect(seedSource(undefined, 'missing', optsWithRecommended)).toEqual({
      kind: 'method',
      method: 'homebrew',
    });
  });

  it('returns recommended method when used is auto and agent is not installed', () => {
    expect(seedSource({ kind: 'auto' }, 'missing', optsWithRecommended)).toEqual({
      kind: 'method',
      method: 'homebrew',
    });
  });

  it('returns auto for an installed agent even when a recommended option exists', () => {
    expect(seedSource({ kind: 'auto' }, 'available', optsWithRecommended)).toEqual({
      kind: 'auto',
    });
  });

  it('returns auto when no options have recommended flag', () => {
    expect(seedSource(undefined, 'missing', optsNoRecommended)).toEqual({ kind: 'auto' });
  });

  it('returns auto when installOptions is empty', () => {
    expect(seedSource(undefined, 'missing', [])).toEqual({ kind: 'auto' });
  });
});
