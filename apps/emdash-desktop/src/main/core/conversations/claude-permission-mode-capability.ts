import type { IExecutionContext } from '@main/core/execution-context/types';

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_MAX_BUFFER = 256 * 1024;
const MINIMUM_SUPPORTED_VERSION = [2, 0, 26] as const;

type LocalHost = {
  kind: 'local';
  platform: NodeJS.Platform;
  uid: number | undefined;
};

type SshHost = {
  kind: 'ssh';
};

type ClaudePermissionModeCapabilityParams = {
  cli: string;
  ctx: Pick<IExecutionContext, 'exec'>;
  host: LocalHost | SshHost;
};

function supportsBypassToggle(versionOutput: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$/.exec(versionOutput.trim());
  if (!match) return false;

  const current = match.slice(1, 4).map(Number);
  for (let index = 0; index < MINIMUM_SUPPORTED_VERSION.length; index += 1) {
    if (current[index]! > MINIMUM_SUPPORTED_VERSION[index]) return true;
    if (current[index]! < MINIMUM_SUPPORTED_VERSION[index]) return false;
  }
  return true;
}

async function hasSafeHostUser(
  ctx: Pick<IExecutionContext, 'exec'>,
  host: LocalHost | SshHost
): Promise<boolean> {
  if (host.kind === 'local') {
    if (host.platform === 'win32') return true;
    return host.uid !== undefined && host.uid > 0;
  }

  try {
    const { stdout } = await ctx.exec('id', ['-u'], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_BUFFER,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const uid = stdout.trim();
    const parsedUid = Number(uid);
    return /^\d+$/.test(uid) && Number.isSafeInteger(parsedUid) && parsedUid > 0;
  } catch {
    return false;
  }
}

async function hasSupportedCli(
  ctx: Pick<IExecutionContext, 'exec'>,
  cli: string
): Promise<boolean> {
  try {
    const { stdout, stderr } = await ctx.exec(cli, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_BUFFER,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return supportsBypassToggle(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}

/**
 * Fail-closed host capability probe for Claude's opt-in bypass mode switch.
 *
 * Outside recognized sandboxes, Claude refuses both bypass flags under
 * root/sudo. We fail closed for uid 0 because Claude's sandbox recognition is
 * not exposed here. The opt-in `--allow-...` flag was added in 2.0.26, so older
 * or unparseable CLIs stay restricted.
 */
export async function canExposeClaudeBypassPermissions({
  cli,
  ctx,
  host,
}: ClaudePermissionModeCapabilityParams): Promise<boolean> {
  if (host.kind === 'local') {
    if (!(await hasSafeHostUser(ctx, host))) return false;
    return hasSupportedCli(ctx, cli);
  }

  const [safeHostUser, supportedCli] = await Promise.all([
    hasSafeHostUser(ctx, host),
    hasSupportedCli(ctx, cli),
  ]);
  return safeHostUser && supportedCli;
}
