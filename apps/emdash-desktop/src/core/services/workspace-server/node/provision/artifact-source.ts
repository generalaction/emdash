import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateWorkspaceServerVersion } from '../layout';

export type WorkspaceServerArtifactPlatform = {
  os: 'linux';
  arch: 'x64' | 'arm64';
  version: string;
};

export type WorkspaceServerArtifact = {
  url: string;
  sha256: string;
};

export type WorkspaceServerArtifactSource = {
  resolve(
    platform: WorkspaceServerArtifactPlatform,
    options?: { signal?: AbortSignal }
  ): Promise<WorkspaceServerArtifact>;
};

export function workspaceServerArtifactName(platform: WorkspaceServerArtifactPlatform): string {
  const version = validateWorkspaceServerVersion(platform.version);
  return `emdash-workspace-server-${version}-${platform.os}-${platform.arch}.tar.gz`;
}

export function createR2WorkspaceServerArtifactSource(
  baseUrl = process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'] ??
    'https://releases.emdash.sh/workspace-server'
): WorkspaceServerArtifactSource {
  return {
    async resolve(platform, options) {
      const name = workspaceServerArtifactName(platform);
      const artifactUrl = new URL(`${platform.version}/${name}`, ensureTrailingSlash(baseUrl));
      const checksumResponse = await fetch(`${artifactUrl.href}.sha256`, {
        signal: options?.signal,
      });
      if (!checksumResponse.ok) {
        throw new Error(
          `Workspace-server checksum download failed: HTTP ${checksumResponse.status}`
        );
      }
      return {
        url: artifactUrl.href,
        sha256: parseChecksum(await checksumResponse.text(), name),
      };
    },
  };
}

export function createRemoteFileWorkspaceServerArtifactSource(options: {
  localDirectory: string;
  remoteDirectory: string;
}): WorkspaceServerArtifactSource {
  if (!path.posix.isAbsolute(options.remoteDirectory)) {
    throw new Error('Remote artifact directory must be an absolute POSIX path');
  }
  return {
    async resolve(platform, resolveOptions) {
      const name = workspaceServerArtifactName(platform);
      const checksum = await readFile(path.join(options.localDirectory, `${name}.sha256`), {
        encoding: 'utf8',
        signal: resolveOptions?.signal,
      });
      return {
        url: pathToFileURL(path.posix.join(options.remoteDirectory, name)).href,
        sha256: parseChecksum(checksum, name),
      };
    },
  };
}

function parseChecksum(contents: string, expectedName: string): string {
  const match = /^([a-f\d]{64})\s+\*?([^\s]+)\s*$/i.exec(contents.trim());
  if (!match || match[2] !== expectedName) {
    throw new Error(`Invalid checksum file for ${expectedName}`);
  }
  return match[1]!.toLowerCase();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
