import path from 'node:path';
import { quoteArg } from '@emdash/core/primitives/exec/api';
import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import { validateWorkspaceServerVersion, type WorkspaceServerLayout } from '../layout';
import type { WorkspaceServerSshPort } from '../ports';
import type { WorkspaceServerArtifact, WorkspaceServerArtifactSource } from './artifact-source';
import type { RemoteHostInfo } from './host-probe';
import installScript from './install.sh?raw';

export type WorkspaceServerInstallErrorCode =
  | 'unsupported-platform'
  | 'artifact-download-failed'
  | 'install-failed';

export class WorkspaceServerInstallError extends Error {
  readonly name = 'WorkspaceServerInstallError';

  constructor(
    readonly code: WorkspaceServerInstallErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

export class WorkspaceServerInstaller {
  constructor(
    private readonly ssh: WorkspaceServerSshPort,
    private readonly artifacts: WorkspaceServerArtifactSource
  ) {}

  async installedVersion(
    connectionId: string,
    layout: WorkspaceServerLayout,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const proxy = await this.ssh.ensureProxy(connectionId);
    const result = await proxy.exec(
      { command: 'readlink', args: ['--', layout.currentLink] },
      {
        signal,
        timeoutMs: 10_000,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 4_096,
      }
    );
    if (result.exitCode !== 0) return undefined;

    const linkTarget = result.stdout.trim();
    const version = path.posix.basename(linkTarget);
    try {
      validateWorkspaceServerVersion(version);
    } catch (error) {
      throw new WorkspaceServerInstallError(
        'install-failed',
        `The managed workspace-server current link is invalid: ${result.stdout.trim()}`,
        { cause: error }
      );
    }
    if (linkTarget !== `versions/${version}` && linkTarget !== layout.versionDirectory(version)) {
      throw new WorkspaceServerInstallError(
        'install-failed',
        `The managed workspace-server current link points outside versions/: ${linkTarget}`
      );
    }
    return version;
  }

  async install(
    connectionId: string,
    host: RemoteHostInfo,
    layout: WorkspaceServerLayout,
    version: string,
    signal?: AbortSignal
  ): Promise<void> {
    validateWorkspaceServerVersion(version);
    const proxy = await this.ssh.ensureProxy(connectionId);
    await this.assertSupported(proxy, host, signal);

    let artifact: WorkspaceServerArtifact;
    try {
      artifact = await this.artifacts.resolve(
        {
          os: 'linux',
          arch: host.arch as 'x64' | 'arm64',
          version,
        },
        { signal }
      );
    } catch (error) {
      throw new WorkspaceServerInstallError(
        'artifact-download-failed',
        `Could not resolve workspace-server ${version}: ${errorMessage(error)}`,
        { cause: error }
      );
    }

    if (!/^[a-f\d]{64}$/i.test(artifact.sha256)) {
      throw new WorkspaceServerInstallError('install-failed', 'Artifact checksum is invalid');
    }
    let url: URL;
    try {
      url = new URL(artifact.url);
    } catch (error) {
      throw new WorkspaceServerInstallError(
        'artifact-download-failed',
        'Workspace-server artifact URL is invalid',
        { cause: error }
      );
    }
    if (!['https:', 'http:', 'file:'].includes(url.protocol)) {
      throw new WorkspaceServerInstallError(
        'artifact-download-failed',
        `Unsupported workspace-server artifact URL protocol '${url.protocol}'`
      );
    }

    const command = buildWorkspaceServerInstallCommand({
      layout,
      version,
      url: artifact.url,
      sha256: artifact.sha256.toLowerCase(),
    });
    const result = await proxy.execScript(command, {
      signal,
      timeoutMs: 5 * 60_000,
      maxStdoutBytes: 256 * 1_024,
      maxStderrBytes: 256 * 1_024,
    });
    if (result.exitCode === 0) return;

    const code = result.exitCode === 41 ? 'artifact-download-failed' : 'install-failed';
    throw new WorkspaceServerInstallError(
      code,
      `Workspace-server installation failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`
    );
  }

  private async assertSupported(
    proxy: SshClientProxy,
    host: RemoteHostInfo,
    signal?: AbortSignal
  ): Promise<void> {
    if (host.os !== 'linux' || (host.arch !== 'x64' && host.arch !== 'arm64')) {
      throw new WorkspaceServerInstallError(
        'unsupported-platform',
        `Workspace-server installation is not supported on ${host.os}-${host.arch}`
      );
    }
    const libc = await proxy.execScript('getconf GNU_LIBC_VERSION 2>/dev/null || true', {
      signal,
      timeoutMs: 10_000,
      maxStdoutBytes: 4_096,
      maxStderrBytes: 4_096,
    });
    if (!libc.stdout.trim().toLowerCase().startsWith('glibc ')) {
      throw new WorkspaceServerInstallError(
        'unsupported-platform',
        'Workspace-server Linux artifacts require glibc; musl remotes are not supported'
      );
    }
  }
}

export function buildWorkspaceServerInstallCommand(options: {
  layout: WorkspaceServerLayout;
  version: string;
  url: string;
  sha256: string;
}): string {
  const { layout, url, sha256 } = options;
  const version = validateWorkspaceServerVersion(options.version);
  const staging = path.posix.join(layout.stagingDirectory, version);
  const variables: WorkspaceServerInstallScriptVariables = {
    version,
    root: layout.root,
    url,
    sha256,
    versions_dir: layout.versionsDirectory,
    version_dir: layout.versionDirectory(version),
    launcher: layout.versionLauncher(version),
    current_link: layout.currentLink,
    staging,
    staging_launcher: path.posix.join(staging, 'bin/emdash-workspace-server'),
    archive: path.posix.join(layout.stagingDirectory, `${version}.tar.gz`),
    next_link: path.posix.join(layout.root, `.current-${version}-$$`),
    run_dir: layout.runDirectory,
    lock: layout.installLock,
    lock_pid_file: path.posix.join(layout.installLock, 'pid'),
  };
  return `${renderWorkspaceServerInstallPrelude(variables)}\n${installScript.trim()}`;
}

export const workspaceServerInstallVariableNames = [
  'version',
  'root',
  'url',
  'sha256',
  'versions_dir',
  'version_dir',
  'launcher',
  'current_link',
  'staging',
  'staging_launcher',
  'archive',
  'next_link',
  'run_dir',
  'lock',
  'lock_pid_file',
] as const;

export type WorkspaceServerInstallScriptVariables = Record<
  (typeof workspaceServerInstallVariableNames)[number],
  string
>;

export function renderWorkspaceServerInstallPrelude(
  variables: WorkspaceServerInstallScriptVariables
): string {
  return workspaceServerInstallVariableNames
    .map((name) => `${name}=${quoteArg(variables[name], 'posix')}`)
    .join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
