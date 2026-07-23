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
    private readonly baseUrl = DEFAULT_WORKSPACE_SERVER_INSTALL_BASE_URL,
    private readonly installCommand?: string
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
    const command = this.installCommand
      ? renderCustomInstallCommand(this.installCommand, this.baseUrl)
      : buildWorkspaceServerInstallCommand(this.baseUrl);
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

  async availableVersion(connectionId: string, signal?: AbortSignal): Promise<string> {
    const proxy = await this.ssh.ensureProxy(connectionId);
    const result = await proxy.execScript(
      buildWorkspaceServerAvailableVersionCommand(this.baseUrl),
      {
        signal,
        timeoutMs: 10_000,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 4_096,
      }
    );
    if (result.exitCode !== 0) {
      throw new WorkspaceServerInstallError(
        'artifact-download-failed',
        `Could not resolve the latest workspace-server version: ${
          result.stderr.trim() || `exit ${result.exitCode}`
        }`
      );
    }

    const version = result.stdout.trim();
    try {
      validateWorkspaceServerVersion(version);
    } catch (error) {
      throw new WorkspaceServerInstallError(
        'artifact-download-failed',
        `The latest workspace-server version is invalid: ${version}`,
        { cause: error }
      );
    }
    return version;
  }
}

export function buildWorkspaceServerAvailableVersionCommand(baseUrl: string): string {
  const normalizedBaseUrl = validateInstallBaseUrl(baseUrl);
  const latestUrl = new URL('latest.txt', ensureTrailingSlash(normalizedBaseUrl));
  if (latestUrl.protocol === 'file:') {
    return `set -eu
cat -- ${quoteArg(fileUrlPath(latestUrl), 'posix')}`;
  }

  const quotedLatestUrl = quoteArg(latestUrl.href, 'posix');
  return `set -eu
if command -v curl >/dev/null 2>&1; then
  curl -fsSL -- ${quotedLatestUrl}
elif command -v wget >/dev/null 2>&1; then
  wget -qO- -- ${quotedLatestUrl}
else
  echo "curl or wget is required to download workspace-server metadata" >&2
  exit 41
fi`;
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

function fileUrlPath(url: URL): string {
  if (url.hostname.length > 0 && url.hostname !== 'localhost') {
    throw new WorkspaceServerInstallError(
      'artifact-download-failed',
      `Unsupported file URL host '${url.hostname}'`
    );
  }
  const path = decodeURIComponent(url.pathname);
  if (!path.startsWith('/')) {
    throw new WorkspaceServerInstallError(
      'artifact-download-failed',
      `Unsupported file URL path '${url.pathname}'`
    );
  }
  return path;
}

function renderCustomInstallCommand(command: string, baseUrl: string): string {
  const normalizedBaseUrl = validateInstallBaseUrl(baseUrl);
  const scriptUrl = new URL('install.sh', ensureTrailingSlash(normalizedBaseUrl)).href;
  return command
    .replaceAll('{{scriptUrl}}', quoteArg(scriptUrl, 'posix'))
    .replaceAll('{{baseUrl}}', quoteArg(normalizedBaseUrl, 'posix'));
}
