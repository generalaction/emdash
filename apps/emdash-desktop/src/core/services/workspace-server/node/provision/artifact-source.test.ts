import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRemoteFileWorkspaceServerArtifactSource,
  workspaceServerArtifactName,
} from './artifact-source';

describe('workspace-server artifact source', () => {
  it('maps a local checksum sidecar to an on-remote file URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-artifacts-'));
    const platform = { os: 'linux' as const, arch: 'arm64' as const, version: '1.2.3' };
    const name = workspaceServerArtifactName(platform);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}.sha256`), `${'a'.repeat(64)}  ${name}\n`);

    try {
      const source = createRemoteFileWorkspaceServerArtifactSource({
        localDirectory: directory,
        remoteDirectory: '/opt/emdash-artifacts',
      });
      await expect(source.resolve(platform)).resolves.toEqual({
        url: `file:///opt/emdash-artifacts/${name}`,
        sha256: 'a'.repeat(64),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
