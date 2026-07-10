export class RepoLock {
  private readonly tails = new Map<string, Promise<void>>();

  async withLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(repoPath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(repoPath, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(repoPath) === tail) this.tails.delete(repoPath);
    }
  }
}

export const repoLock = new RepoLock();

export const noRepoLock: Pick<RepoLock, 'withLock'> = {
  async withLock<T>(_repoPath: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};
