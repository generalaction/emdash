import type { IExecutionContext } from '@main/core/execution-context/types';
import { GITHUB_DOT_COM_HOST } from '@shared/github-repository';

function hostnameArgs(host: string): string[] {
  return host === GITHUB_DOT_COM_HOST ? [] : ['--hostname', host];
}

export async function isGhCliAuthenticated(
  ctx: IExecutionContext,
  host: string = GITHUB_DOT_COM_HOST
): Promise<boolean> {
  try {
    await ctx.exec('gh', ['auth', 'status', ...hostnameArgs(host)]);
    return true;
  } catch {
    return false;
  }
}

export async function extractGhCliToken(
  ctx: IExecutionContext,
  host: string = GITHUB_DOT_COM_HOST
): Promise<string | null> {
  try {
    const { stdout } = await ctx.exec('gh', ['auth', 'token', ...hostnameArgs(host)]);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}
