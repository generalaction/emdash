import path from 'node:path';
import { quoteArg } from '@emdash/core/primitives/exec/api';
import { validateWorkspaceServerVersion, type WorkspaceServerLayout } from '../layout';
import type { WorkspaceServerSshPort } from '../ports';

export const DEFAULT_WORKSPACE_SERVER_INSTALL_BASE_URL =
  'https://releases.emdash.sh/workspace-server';

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
    private readonly baseUrl = process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'] ??
      DEFAULT_WORKSPACE_SERVER_INSTALL_BASE_URL
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

  async install(connectionId: string, signal?: AbortSignal): Promise<void> {
    const proxy = await this.ssh.ensureProxy(connectionId);
    const command = buildWorkspaceServerInstallCommand(this.baseUrl);
    const result = await proxy.execScript(command, {
      signal,
      timeoutMs: 5 * 60_000,
      maxStdoutBytes: 256 * 1_024,
      maxStderrBytes: 256 * 1_024,
    });
    if (result.exitCode === 0) return;

    const code =
      result.exitCode === 40
        ? 'unsupported-platform'
        : result.exitCode === 41
          ? 'artifact-download-failed'
          : 'install-failed';
    throw new WorkspaceServerInstallError(
      code,
      `Workspace-server installation failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`
    );
  }
}

export function buildWorkspaceServerInstallCommand(baseUrl: string): string {
  const normalizedBaseUrl = validateInstallBaseUrl(baseUrl);
  const scriptUrl = new URL('install.sh', ensureTrailingSlash(normalizedBaseUrl)).href;
  const quotedScriptUrl = quoteArg(scriptUrl, 'posix');
  const quotedBaseUrl = quoteArg(normalizedBaseUrl, 'posix');
  return `set -eu
install_script=\${TMPDIR:-/tmp}/emdash-workspace-server-install-$$.sh
cleanup() { rm -f -- "$install_script"; }
trap cleanup EXIT HUP INT TERM
if ! curl -fsSL --output "$install_script" -- ${quotedScriptUrl}; then
  exit 41
fi
sh "$install_script" --base-url ${quotedBaseUrl}`;
}

function validateInstallBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new WorkspaceServerInstallError(
      'artifact-download-failed',
      'Workspace-server install base URL is invalid',
      { cause: error }
    );
  }
  if (!['https:', 'http:', 'file:'].includes(url.protocol)) {
    throw new WorkspaceServerInstallError(
      'artifact-download-failed',
      `Unsupported workspace-server install URL protocol '${url.protocol}'`
    );
  }
  return url.href.replace(/\/$/, '');
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
