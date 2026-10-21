import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  duplicateChannelManifests,
  findManifests,
  mergeUpdateManifests,
  refreshUpdateManifestMetadata,
  resolvePublishChannels,
  updateManifestFiles,
  updateManifestFileUrls,
  updateManifestVersion,
  versionUpdateManifestUrls,
} from './artifacts.ts';

describe('duplicateChannelManifests', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'artifacts-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies latest*.yml to v1-stable*.yml', () => {
    const content = 'version: 1.1.34\nfiles: []\n';
    writeFileSync(join(dir, 'latest-mac.yml'), content);
    writeFileSync(join(dir, 'latest-linux.yml'), content);
    writeFileSync(join(dir, 'latest.yml'), content);

    const created = duplicateChannelManifests('latest', 'v1-stable', dir);

    expect(created).toHaveLength(3);
    const names = created
      .map((f) => f.split('/').pop())
      .sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    expect(names).toEqual(['v1-stable-linux.yml', 'v1-stable-mac.yml', 'v1-stable.yml']);
  });

  it('created files have identical content to sources', () => {
    const content = 'version: 1.2.0\nfiles:\n  - url: emdash-arm64.zip\n';
    writeFileSync(join(dir, 'latest-mac.yml'), content);

    duplicateChannelManifests('latest', 'v1-stable', dir);

    const copied = readFileSync(join(dir, 'v1-stable-mac.yml'), 'utf-8');
    expect(copied).toBe(content);
  });

  it('returns empty array when sourceChannel equals targetChannel', () => {
    writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.0.0\n');
    const created = duplicateChannelManifests('latest', 'latest', dir);
    expect(created).toHaveLength(0);
  });

  it('returns empty array when no source manifests exist', () => {
    const created = duplicateChannelManifests('latest', 'v1-stable', dir);
    expect(created).toHaveLength(0);
  });

  it('does not copy non-yml files', () => {
    writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.0.0\n');
    writeFileSync(join(dir, 'latest-mac.dmg'), 'binary');

    const created = duplicateChannelManifests('latest', 'v1-stable', dir);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/v1-stable-mac\.yml$/);
  });

  it('handles canary channel duplication', () => {
    writeFileSync(join(dir, 'canary-mac.yml'), 'version: 1.1.34-canary.10\n');
    writeFileSync(join(dir, 'canary-linux.yml'), 'version: 1.1.34-canary.10\n');
    writeFileSync(join(dir, 'canary.yml'), 'version: 1.1.34-canary.10\n');

    const created = duplicateChannelManifests('canary', 'v1-canary', dir);

    expect(created).toHaveLength(3);
    const names = created
      .map((f) => f.split('/').pop())
      .sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    expect(names).toEqual(['v1-canary-linux.yml', 'v1-canary-mac.yml', 'v1-canary.yml']);
  });
});

describe('resolvePublishChannels', () => {
  it('extracts github and generic channels', () => {
    const publish = [
      { provider: 'github', owner: 'org', repo: 'repo', channel: 'latest' },
      { provider: 'generic', url: 'https://example.com', channel: 'v1-stable' },
    ];
    const { githubChannel, r2Channel } = resolvePublishChannels(publish);
    expect(githubChannel).toBe('latest');
    expect(r2Channel).toBe('v1-stable');
  });

  it('defaults github channel to "latest" when not specified', () => {
    const publish = [
      { provider: 'github', owner: 'org', repo: 'repo' },
      { provider: 'generic', url: 'https://example.com', channel: 'v1-stable' },
    ];
    const { githubChannel } = resolvePublishChannels(publish);
    expect(githubChannel).toBe('latest');
  });

  it('returns r2Channel undefined when no generic provider present', () => {
    const publish = [{ provider: 'github', owner: 'org', repo: 'repo', channel: 'latest' }];
    const { r2Channel } = resolvePublishChannels(publish);
    expect(r2Channel).toBeUndefined();
  });

  it('handles canary config', () => {
    const publish = [
      { provider: 'github', owner: 'org', repo: 'repo', channel: 'canary' },
      { provider: 'generic', url: 'https://example.com', channel: 'v1-canary' },
    ];
    const { githubChannel, r2Channel } = resolvePublishChannels(publish);
    expect(githubChannel).toBe('canary');
    expect(r2Channel).toBe('v1-canary');
  });

  it('skips string entries in the publish array', () => {
    const publish = [
      'github',
      { provider: 'generic', url: 'https://example.com', channel: 'v1-stable' },
    ];
    const { githubChannel, r2Channel } = resolvePublishChannels(publish);
    expect(githubChannel).toBe('latest');
    expect(r2Channel).toBe('v1-stable');
  });

  it('returns undefined r2Channel when generic channel is not a string', () => {
    const publish = [
      { provider: 'github', channel: 'latest' },
      { provider: 'generic', channel: 42 },
    ];
    const { r2Channel } = resolvePublishChannels(publish);
    expect(r2Channel).toBeUndefined();
  });
});

describe('findManifests with missing-manifest guard scenario', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'artifacts-guard-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty array when channel manifests are absent (guard trigger condition)', () => {
    // Simulate the state where build emits latest*.yml but v1-stable*.yml was not duplicated.
    writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.1.33\n');
    writeFileSync(join(dir, 'emdash-arm64.dmg'), 'binary');

    const missing = findManifests('v1-stable', dir);
    expect(missing).toHaveLength(0);

    // The final release asset inventory catches this before channel promotion.
  });

  it('returns manifests when channel has been correctly duplicated', () => {
    writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.1.34\n');
    duplicateChannelManifests('latest', 'v1-stable', dir);

    const found = findManifests('v1-stable', dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/v1-stable-mac\.yml$/);
  });
});

describe('update manifest transformations', () => {
  const x64 = `version: 1.2.3
files:
  - url: emdash-x64.zip
    sha512: x64-checksum
path: emdash-x64.zip
sha512: x64-checksum
releaseDate: 2026-01-01T00:00:00.000Z
`;
  const arm64 = `version: 1.2.3
files:
  - url: emdash-arm64.zip
    sha512: arm64-checksum
path: emdash-arm64.zip
sha512: arm64-checksum
releaseDate: 2026-01-01T00:00:01.000Z
`;

  it('merges per-architecture manifests without dropping either updater file', () => {
    const merged = mergeUpdateManifests([x64, arm64]);

    expect(updateManifestFileUrls(merged)).toEqual(['emdash-x64.zip', 'emdash-arm64.zip']);
    expect(updateManifestVersion(merged)).toBe('1.2.3');
    expect(merged).toContain('path: emdash-x64.zip');
  });

  it('rejects version and checksum conflicts', () => {
    expect(() => mergeUpdateManifests([x64, arm64.replace('1.2.3', '1.2.4')])).toThrow(
      'different versions'
    );
    expect(() =>
      mergeUpdateManifests([x64, x64.replace('x64-checksum', 'different-checksum')])
    ).toThrow('Conflicting checksums');
  });

  it('rewrites updater URLs to an immutable release prefix', () => {
    const versioned = versionUpdateManifestUrls(
      x64,
      'releases/v1.2.3/123-1',
      new Set(['emdash-x64.zip'])
    );

    expect(updateManifestFileUrls(versioned)).toEqual(['releases/v1.2.3/123-1/emdash-x64.zip']);
    expect(versioned).toContain('path: releases/v1.2.3/123-1/emdash-x64.zip');
  });

  it('refreshes checksums and sizes from final artifact bytes', () => {
    const refreshed = refreshUpdateManifestMetadata(
      x64,
      new Map([['emdash-x64.zip', { sha512: 'final-checksum', size: 42 }]])
    );

    expect(updateManifestFiles(refreshed)).toEqual([
      { url: 'emdash-x64.zip', sha512: 'final-checksum', size: 42 },
    ]);
    expect(refreshed).toContain('sha512: final-checksum');
  });

  it('refuses to refresh manifests that do not resolve to final local artifacts', () => {
    expect(() => refreshUpdateManifestMetadata(x64, new Map())).toThrow(
      'No final artifact metadata'
    );
    expect(() =>
      refreshUpdateManifestMetadata(
        x64.replaceAll('emdash-x64.zip', '../emdash-x64.zip'),
        new Map([['emdash-x64.zip', { sha512: 'checksum', size: 42 }]])
      )
    ).toThrow('non-local artifact');
  });

  it('rejects traversal and references to unavailable assets', () => {
    expect(() =>
      versionUpdateManifestUrls(x64, 'releases/v1.2.3/123-1', new Set<string>())
    ).toThrow('unknown release asset');
    expect(() =>
      versionUpdateManifestUrls(
        x64.replaceAll('emdash-x64.zip', '../emdash-x64.zip'),
        'releases/v1.2.3/123-1',
        new Set(['emdash-x64.zip'])
      )
    ).toThrow('unknown release asset');
  });
});
