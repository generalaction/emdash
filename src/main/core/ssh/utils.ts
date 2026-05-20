import type { IExecutionContext } from '@main/core/execution-context/types';
import { resolveIdentityAgentFromSshConfig } from '@main/core/ssh/resolve-ssh-config';

export async function resolveIdentityAgent(hostname: string): Promise<string | undefined> {
  return await resolveIdentityAgentFromSshConfig(hostname).catch(() => undefined);
}

export async function resolveRemoteHome(ctx: IExecutionContext): Promise<string> {
  const { stdout } = await ctx.exec('sh', ['-c', 'printf %s "$HOME"']);
  const home = stdout.trim();
  if (!home) {
    throw new Error('Remote home directory is empty');
  }
  return home;
}
