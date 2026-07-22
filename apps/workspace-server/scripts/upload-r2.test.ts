import { describe, expect, it } from 'vitest';
import {
  contentTypeForObjectKey,
  expectedArtifactNames,
  immutableUploadDecision,
  installScriptObjectKey,
  latestVersionContents,
  latestVersionObjectKey,
  parseArtifactChecksum,
  versionedArtifactObjectKey,
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

  it('places every object under the workspace-server prefix', () => {
    expect(installScriptObjectKey).toBe('workspace-server/install.sh');
    expect(latestVersionObjectKey).toBe('workspace-server/latest.txt');
    expect(versionedArtifactObjectKey('1.2.3', 'server.tar.gz')).toBe(
      'workspace-server/1.2.3/server.tar.gz'
    );
    expect(latestVersionContents('1.2.3')).toBe('1.2.3\n');
  });

  it('rejects unsafe versions and artifact names', () => {
    expect(() => latestVersionContents('../latest')).toThrow(/Invalid workspace-server/);
    expect(() => versionedArtifactObjectKey('1.2.3', '../server.tar.gz')).toThrow(
      /single non-empty path component/
    );
  });

  it('assigns content types for release objects', () => {
    expect(contentTypeForObjectKey(installScriptObjectKey)).toBe('text/x-shellscript');
    expect(contentTypeForObjectKey(latestVersionObjectKey)).toBe('text/plain');
    expect(contentTypeForObjectKey('workspace-server/1.2.3/server.tar.gz.sha256')).toBe(
      'text/plain'
    );
    expect(contentTypeForObjectKey('workspace-server/1.2.3/server.tar.gz')).toBe(
      'application/octet-stream'
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
