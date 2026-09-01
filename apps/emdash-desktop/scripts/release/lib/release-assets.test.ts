import { describe, expect, it } from 'vitest';
import {
  expectedManifestFiles,
  expectedReleaseAssets,
  findMissingReleaseAssets,
  forbiddenReleaseAssets,
  isPlatformReleaseAsset,
  releaseIdentity,
  selectedReleaseArches,
} from './release-assets.ts';

describe('selectedReleaseArches', () => {
  it('expands both in a stable order', () => {
    expect(selectedReleaseArches('both')).toEqual(['x64', 'arm64']);
  });

  it('keeps a single requested architecture', () => {
    expect(selectedReleaseArches('arm64')).toEqual(['arm64']);
  });
});

describe('expectedReleaseAssets', () => {
  it('requires all stable installers and manifests for a dual-architecture release', () => {
    const assets = expectedReleaseAssets('stable', 'both');

    expect(assets).toContain('emdash-x86_64.AppImage');
    expect(assets).toContain('emdash-amd64.deb');
    expect(assets).toContain('emdash-x86_64.rpm');
    expect(assets).toContain('emdash-arm64.AppImage');
    expect(assets).toContain('emdash-arm64.deb');
    expect(assets).toContain('emdash-aarch64.rpm');
    expect(assets).toContain('latest-linux.yml');
    expect(assets).toContain('latest-linux-arm64.yml');
    expect(assets).toContain('v1-stable-linux.yml');
    expect(assets).toContain('v1-stable-linux-arm64.yml');
  });

  it('does not require x64 macOS or Linux assets for an ARM-only canary', () => {
    const assets = expectedReleaseAssets('canary', 'arm64');

    expect(assets).toContain('emdash-canary-arm64.dmg');
    expect(assets).toContain('emdash-canary-arm64.AppImage');
    expect(assets).toContain('canary-linux-arm64.yml');
    expect(assets).not.toContain('emdash-canary-x64.dmg');
    expect(assets).not.toContain('emdash-canary-x86_64.AppImage');
    expect(assets).not.toContain('canary-linux.yml');
  });

  it('always requires the supported x64 Windows artifacts', () => {
    expect(expectedReleaseAssets('stable', 'arm64')).toEqual(
      expect.arrayContaining(['emdash-x64.exe', 'emdash-x64.msi', 'latest.yml'])
    );
  });
});

describe('findMissingReleaseAssets', () => {
  it('returns only absent assets', () => {
    expect(findMissingReleaseAssets(['one', 'three'], ['one', 'two', 'three'])).toEqual(['two']);
  });
});

describe('releaseIdentity', () => {
  it('keeps GitHub and R2 channel identities explicit', () => {
    expect(releaseIdentity('stable')).toEqual({
      artifactPrefix: 'emdash',
      githubChannel: 'latest',
      r2Channel: 'v1-stable',
    });
    expect(releaseIdentity('canary')).toEqual({
      artifactPrefix: 'emdash-canary',
      githubChannel: 'canary',
      r2Channel: 'v1-canary',
    });
  });
});

describe('isPlatformReleaseAsset', () => {
  it('selects only final artifacts and manifests for the requested platform', () => {
    expect(isPlatformReleaseAsset('emdash-arm64.dmg', 'stable', 'mac')).toBe(true);
    expect(isPlatformReleaseAsset('emdash-arm64.zip.blockmap', 'stable', 'mac')).toBe(true);
    expect(isPlatformReleaseAsset('latest-mac.yml', 'stable', 'mac')).toBe(true);
    expect(isPlatformReleaseAsset('v1-stable-mac.yml', 'stable', 'mac')).toBe(true);
    expect(isPlatformReleaseAsset('emdash-arm64.AppImage', 'stable', 'linux')).toBe(true);
    expect(isPlatformReleaseAsset('latest-linux-arm64.yml', 'stable', 'linux')).toBe(true);
    expect(isPlatformReleaseAsset('emdash-x64.exe', 'stable', 'win')).toBe(true);
    expect(isPlatformReleaseAsset('v1-stable.yml', 'stable', 'win')).toBe(true);
  });

  it('rejects other-platform, other-channel, and debug files', () => {
    expect(isPlatformReleaseAsset('emdash-arm64.dmg', 'stable', 'linux')).toBe(false);
    expect(isPlatformReleaseAsset('canary-mac.yml', 'stable', 'mac')).toBe(false);
    expect(isPlatformReleaseAsset('emdash-canary-arm64.dmg', 'stable', 'mac')).toBe(false);
    expect(isPlatformReleaseAsset('builder-debug.yml', 'stable', 'mac')).toBe(false);
    expect(isPlatformReleaseAsset('emdash-arm64.dmg.sha256', 'stable', 'mac')).toBe(false);
  });
});

describe('expectedManifestFiles', () => {
  it('requires both mac architectures in a dual-architecture release', () => {
    const manifests = expectedManifestFiles('stable', 'both');

    expect(manifests.get('latest-mac.yml')).toEqual([
      'emdash-x64.zip',
      'emdash-x64.dmg',
      'emdash-arm64.zip',
      'emdash-arm64.dmg',
    ]);
    expect(manifests.get('v1-stable-mac.yml')).toEqual([
      'emdash-x64.zip',
      'emdash-x64.dmg',
      'emdash-arm64.zip',
      'emdash-arm64.dmg',
    ]);
    expect(manifests.get('latest-linux.yml')).toEqual([
      'emdash-x86_64.AppImage',
      'emdash-amd64.deb',
      'emdash-x86_64.rpm',
    ]);
    expect(manifests.get('latest-linux-arm64.yml')).toEqual([
      'emdash-arm64.AppImage',
      'emdash-arm64.deb',
      'emdash-aarch64.rpm',
    ]);
  });

  it('requires only selected architecture entries for a partial release', () => {
    const manifests = expectedManifestFiles('canary', 'arm64');

    expect(manifests.get('canary-mac.yml')).toEqual([
      'emdash-canary-arm64.zip',
      'emdash-canary-arm64.dmg',
    ]);
    expect(manifests.has('canary-linux.yml')).toBe(false);
    expect(manifests.get('v1-canary-linux-arm64.yml')).toEqual([
      'emdash-canary-arm64.AppImage',
      'emdash-canary-arm64.deb',
      'emdash-canary-aarch64.rpm',
    ]);
  });
});

describe('forbiddenReleaseAssets', () => {
  it('rejects stale assets for an architecture that was not selected', () => {
    expect(forbiddenReleaseAssets('stable', 'x64')).toEqual(
      expect.arrayContaining([
        'emdash-arm64.AppImage',
        'emdash-arm64.deb',
        'emdash-aarch64.rpm',
        'emdash-arm64.dmg',
        'emdash-arm64.zip',
        'latest-linux-arm64.yml',
        'v1-stable-linux-arm64.yml',
      ])
    );
    expect(forbiddenReleaseAssets('stable', 'x64')).toHaveLength(7);
  });

  it('has no forbidden architecture assets when both are selected', () => {
    expect(forbiddenReleaseAssets('stable', 'both')).toEqual([]);
  });
});
