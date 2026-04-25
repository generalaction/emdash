import type { ExecFn } from '@main/core/utils/exec';

export async function isGhCliAuthenticated(exec: ExecFn): Promise<boolean> {
  try {
    await exec('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

export async function extractGhCliToken(exec: ExecFn): Promise<string | null> {
  try {
    const { stdout } = await exec('gh', ['auth', 'token']);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}
