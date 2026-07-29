import { createKeyedLanes } from '@emdash/shared/concurrency';

export class RepoLock {
  private readonly lanes = createKeyedLanes();

  async withLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    return await this.lanes.run(repoPath, new AbortController().signal, fn);
  }
}

export const repoLock = new RepoLock();

export const noRepoLock: Pick<RepoLock, 'withLock'> = {
  async withLock<T>(_repoPath: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};
