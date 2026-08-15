import { describe, expect, it } from 'vitest';
import { parsePackageTarget } from './package-helpers';
import {
  artifactVersionFromArchiveName,
  assertPointerVersionPublishedInRun,
  cacheControlForObjectKey,
  channelPointerObjectKey,
  channelPointerUrl,
  contentTypeForObjectKey,
  expectedArtifactNames,
  immutableUploadDecision,
  installScriptObjectKey,
  latestVersionContents,
  latestVersionObjectKey,
  mutableReleaseObjectKeys,
  parseUploadArgs,
  parseArtifactChecksum,
  publishesStableRootObjects,
  versionedArtifactObjectKey,
  versionedInstallScriptObjectKey,
} from './upload-helpers';

describe('workspace-server R2 upload helpers', () => {
  it('builds the complete expected artifact set', () => {
    expect(expectedArtifactNames('1.2.3')).toEqual([
      'emdash-workspace-server-1.2.3-linux-x64.tar.gz',
      'emdash-workspace-server-1.2.3-linux-x64.tar.gz.sha256',
      'emdash-workspace-server-1.2.3-linux-arm64.tar.gz',
      'emdash-workspace-server-1.2.3-linux-arm64.tar.gz.sha256',
      'emdash-workspace-server-1.2.3-darwin-arm64.tar.gz',
      'emdash-workspace-server-1.2.3-darwin-arm64.tar.gz.sha256',
    ]);
  });

  it('builds the expected artifact set for selected targets', () => {
    expect(expectedArtifactNames('1.2.3', [parsePackageTarget('linux-arm64')])).toEqual([
      'emdash-workspace-server-1.2.3-linux-arm64.tar.gz',
      'emdash-workspace-server-1.2.3-linux-arm64.tar.gz.sha256',
    ]);
  });

  it('parses versions from target artifact archive names', () => {
    const linuxArm64 = parsePackageTarget('linux-arm64');
    expect(
      artifactVersionFromArchiveName(
        'emdash-workspace-server-1.2.3-dev.abc123.1234567890-linux-arm64.tar.gz',
        linuxArm64
      )
    ).toBe('1.2.3-dev.abc123.1234567890');
    expect(
      artifactVersionFromArchiveName(
        'emdash-workspace-server-1.2.3-dev.abc123.1234567890-linux-x64.tar.gz',
        linuxArm64
      )
    ).toBeUndefined();
  });

  it('places every object under the workspace-server prefix', () => {
    expect(installScriptObjectKey).toBe('workspace-server/install.sh');
    expect(latestVersionObjectKey).toBe('workspace-server/latest.txt');
    expect(channelPointerObjectKey('stable', 1)).toBe(
      'workspace-server/channels/stable/protocol-1.json'
    );
    expect(channelPointerObjectKey('canary', 1)).toBe(
      'workspace-server/channels/canary/protocol-1.json'
    );
    expect(versionedArtifactObjectKey('1.2.3', 'server.tar.gz')).toBe(
      'workspace-server/1.2.3/server.tar.gz'
    );
    expect(versionedInstallScriptObjectKey('1.2.3')).toBe('workspace-server/1.2.3/install.sh');
    expect(latestVersionContents('1.2.3')).toBe('1.2.3\n');
  });

  it('builds public channel pointer URLs from a bucket root', () => {
    expect(channelPointerUrl('https://releases.example.test', 'stable', 1)).toBe(
      'https://releases.example.test/workspace-server/channels/stable/protocol-1.json'
    );
    expect(channelPointerUrl('http://localhost:9000/emdash-releases/', 'canary', 2)).toBe(
      'http://localhost:9000/emdash-releases/workspace-server/channels/canary/protocol-2.json'
    );
  });

  it('rejects unsafe versions and artifact names', () => {
    expect(() => latestVersionContents('../latest')).toThrow(/Invalid workspace-server/);
    expect(() => latestVersionContents('1.2.3+build.1')).toThrow(/Invalid workspace-server/);
    expect(() => versionedArtifactObjectKey('1.2.3', '../server.tar.gz')).toThrow(
      /single non-empty path component/
    );
  });

  it('assigns content types for release objects', () => {
    expect(contentTypeForObjectKey(installScriptObjectKey)).toBe('text/x-shellscript');
    expect(contentTypeForObjectKey(latestVersionObjectKey)).toBe('text/plain');
    expect(contentTypeForObjectKey(channelPointerObjectKey('stable', 1))).toBe('application/json');
    expect(contentTypeForObjectKey('workspace-server/1.2.3/server.tar.gz.sha256')).toBe(
      'text/plain'
    );
    expect(contentTypeForObjectKey('workspace-server/1.2.3/server.tar.gz')).toBe(
      'application/octet-stream'
    );
  });

  it('assigns cache policy from object mutability', () => {
    expect(cacheControlForObjectKey(channelPointerObjectKey('stable', 1))).toBe('no-cache');
    expect(cacheControlForObjectKey(installScriptObjectKey)).toBe('no-cache');
    expect(cacheControlForObjectKey(latestVersionObjectKey)).toBe('no-cache');
    expect(cacheControlForObjectKey(versionedInstallScriptObjectKey('1.2.3'))).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(cacheControlForObjectKey(versionedArtifactObjectKey('1.2.3', 'server.tar.gz'))).toBe(
      'public, max-age=31536000, immutable'
    );
  });

  it('defaults uploads to stable and accepts unique repeatable channels', () => {
    expect(parseUploadArgs([]).channels).toEqual(['stable']);
    expect(
      parseUploadArgs(['--channel', 'canary', '--channel=stable', '--channel', 'canary']).channels
    ).toEqual(['canary', 'stable']);
  });

  it('rejects unknown or missing release channels', () => {
    expect(() => parseUploadArgs(['--channel', 'preview'])).toThrow(
      "Invalid workspace-server release channel 'preview'"
    );
    expect(() => parseUploadArgs(['--channel'])).toThrow('--channel requires a value');
  });

  it('does not select legacy root objects for a canary-only upload', () => {
    expect(publishesStableRootObjects(['canary'])).toBe(false);
    expect(publishesStableRootObjects(['canary', 'stable'])).toBe(true);
  });

  it('publishes the stable channel pointer before legacy root selectors', () => {
    expect(mutableReleaseObjectKeys(['stable'], 1)).toEqual([
      channelPointerObjectKey('stable', 1),
      installScriptObjectKey,
      latestVersionObjectKey,
    ]);
  });

  it('only permits pointers to versions published in the current run', () => {
    const pointer = { artifactVersion: '1.2.3', protocolVersion: '1.0.0' };
    expect(() => assertPointerVersionPublishedInRun(pointer, new Set(['1.2.3']))).not.toThrow();
    expect(() => assertPointerVersionPublishedInRun(pointer, new Set(['1.2.2']))).toThrow(
      /version was not published in this run/
    );
  });

  it('parses checksum sidecars and verifies their filename', () => {
    const checksum = 'A'.repeat(64);
    expect(parseArtifactChecksum(`${checksum}  server.tar.gz\n`, 'server.tar.gz')).toBe(
      checksum.toLowerCase()
    );
    expect(() => parseArtifactChecksum(`${checksum}  another.tar.gz\n`, 'server.tar.gz')).toThrow(
      /Invalid checksum sidecar/
    );
  });

  it('skips equal immutable objects and rejects replacements', () => {
    const local = 'a'.repeat(64);
    expect(immutableUploadDecision(local)).toBe('upload');
    expect(immutableUploadDecision(local, local)).toBe('skip');
    expect(() => immutableUploadDecision(local, 'b'.repeat(64))).toThrow(
      /Refusing to replace immutable object/
    );
  });
});
