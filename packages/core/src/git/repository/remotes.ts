import type { BoundExec } from '../../exec';
import type { GitRemote } from './models/refs';
import type { GitRemotesModel } from './models/remotes';

export async function computeRemotesModel(exec: BoundExec): Promise<GitRemotesModel> {
  const { stdout } = await exec.exec(['remote', '-v']);
  const seen = new Set<string>();
  const remotes: GitRemote[] = [];

  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (!match || match[3] !== 'fetch') continue;
    const name = match[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    remotes.push({ name, url: match[2]! });
  }

  return { remotes };
}

export function remoteNameForRepositoryUrl(url: string): string {
  const withoutSuffix = url.replace(/\.git$/, '');
  const tail = withoutSuffix.split(/[/:]/).filter(Boolean).slice(-2).join('-');
  return `fork-${tail || 'remote'}`.replace(/[^A-Za-z0-9._-]/g, '-');
}
