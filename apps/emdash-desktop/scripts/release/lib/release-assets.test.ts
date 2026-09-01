import { describe, expect, it } from 'vitest';
import {
  expectedManifestFiles,
  expectedReleaseAssets,
  findMissingReleaseAssets,
  isPlatformReleaseAsset,
  releaseIdentity,
} from './release-assets.ts';

describe('expectedReleaseAssets', () => {
  it('requires all stable installers and manifests', () => {
    const assets = expectedReleaseAssets('stable');

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

  it('requires the complete canary architecture set', () => {
    const assets = expectedReleaseAssets('canary');
    expect(assets).toContain('emdash-canary-arm64.dmg');
    expect(assets).toContain('emdash-canary-arm64.AppImage');
    expect(assets).toContain('canary-linux-arm64.yml');
    expect(assets).toContain('emdash-canary-x64.dmg');
    expect(assets).toContain('emdash-canary-x86_64.AppImage');
    expect(assets).toContain('canary-linux.yml');
    expect(assets).toEqual(
      expect.arrayContaining(['emdash-canary-x64.exe', 'emdash-canary-x64.msi', 'canary.yml'])
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
  it('requires the complete architecture set', () => {
    const manifests = expectedManifestFiles('stable');

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

  it('requires both canary Linux manifests', () => {
    const manifests = expectedManifestFiles('canary');

    expect(manifests.get('canary-linux.yml')).toEqual([
      'emdash-canary-x86_64.AppImage',
      'emdash-canary-amd64.deb',
      'emdash-canary-x86_64.rpm',
    ]);
    expect(manifests.get('v1-canary-linux-arm64.yml')).toEqual([
      'emdash-canary-arm64.AppImage',
      'emdash-canary-arm64.deb',
      'emdash-canary-aarch64.rpm',
    ]);
  });
});
