import {
  gitClient,
  gitWorker,
  type GitRuntimeClient,
} from '@main/core/wire-workers/desktop-workers';

export type { GitRuntimeClient } from '@main/core/wire-workers/desktop-workers';

export async function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  await gitWorker.ready();
  return gitClient;
}
