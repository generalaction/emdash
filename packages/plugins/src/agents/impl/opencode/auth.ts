import type {
  AgentAuthContext,
  AgentAuthStatus,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { authenticatedFromEnv } from '../../helpers/auth';

const AUTH_STATUS_TIMEOUT_MS = 5_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PROVIDER_API_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'ORCAROUTER_API_KEY',
];

export async function opencodeAuthStatus(ctx: AgentAuthContext): Promise<AgentAuthStatus> {
  const envStatus = authenticatedFromEnv(ctx, PROVIDER_API_ENV_VARS);
  if (envStatus.kind === 'authenticated') return envStatus;
  if (hasLoopbackBaseUrl(ctx.env.OPENAI_BASE_URL)) {
    return { kind: 'authenticated' };
  }

  try {
    const { stdout, stderr } = await ctx.exec(ctx.cli, ['auth', 'list'], {
      timeout: AUTH_STATUS_TIMEOUT_MS,
    });
    return statusFromAuthListOutput(`${stdout}\n${stderr}`);
  } catch (error) {
    const output = outputFromExecError(error);
    return statusFromAuthListOutput(output);
  }
}

function statusFromAuthListOutput(output: string): AgentAuthStatus {
  const count = credentialCount(output);
  if (count === null) return { kind: 'unknown' };
  return count > 0 ? { kind: 'authenticated' } : { kind: 'unauthenticated' };
}

function credentialCount(output: string): number | null {
  const match = output.match(/\b(\d+)\s+credentials?\b/i);
  return match ? Number(match[1]) : null;
}

function hasLoopbackBaseUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function outputFromExecError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const withOutput = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  return [withOutput.stdout, withOutput.stderr, withOutput.message]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
}
