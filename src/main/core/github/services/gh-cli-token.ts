import type { IExecutionContext } from '@main/core/execution-context/types';

export async function isGhCliAuthenticated(ctx: IExecutionContext): Promise<boolean> {
  try {
    await ctx.exec('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

export async function extractGhCliToken(ctx: IExecutionContext): Promise<string | null> {
  try {
    const { stdout } = await ctx.exec('gh', ['auth', 'token']);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}
