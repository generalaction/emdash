import type { Lease } from '@emdash/shared';
import type { IGitCheckout } from '../checkout/types';
import { createGitSessionJobs } from '../jobs';
import type { IGitRepository } from '../repository/types';
import type { CheckoutLease, IGitRuntime, RepoLease } from '../types';
import type { GitApiContext } from './middlewares';

export type GitSession = {
  context: GitApiContext;
  dispose: () => Promise<void>;
};

export function createGitSession(runtime: IGitRuntime): GitSession {
  const resources = new GitSessionResources(runtime);
  const jobs = createGitSessionJobs(runtime, resources);
  return {
    context: { runtime, jobs, resources },
    dispose: async () => {
      jobs.dispose();
      await resources.dispose();
    },
  };
}

export class GitSessionResources {
  private readonly repositories = new Map<string, Promise<RepoLease>>();
  private readonly checkouts = new Map<string, Promise<CheckoutLease>>();
  private disposed = false;

  constructor(private readonly runtime: IGitRuntime) {}

  async repository(repositoryRoot: string): Promise<IGitRepository> {
    return (await this.repositoryLease(repositoryRoot)).value;
  }

  async checkout(checkoutPath: string): Promise<IGitCheckout> {
    return (await this.checkoutLease(checkoutPath)).value;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const releases = [
      ...[...this.repositories.values()].map((lease) => releaseLease(lease)),
      ...[...this.checkouts.values()].map((lease) => releaseLease(lease)),
    ];
    this.repositories.clear();
    this.checkouts.clear();
    await Promise.all(releases);
  }

  private repositoryLease(repositoryRoot: string): Promise<RepoLease> {
    this.assertOpen();
    let lease = this.repositories.get(repositoryRoot);
    if (!lease) {
      lease = this.runtime.openRepository(repositoryRoot);
      this.repositories.set(repositoryRoot, lease);
      evictOnFailure(this.repositories, repositoryRoot, lease);
    }
    return lease;
  }

  private checkoutLease(checkoutPath: string): Promise<CheckoutLease> {
    this.assertOpen();
    let lease = this.checkouts.get(checkoutPath);
    if (!lease) {
      lease = this.runtime.openCheckout(checkoutPath);
      this.checkouts.set(checkoutPath, lease);
      evictOnFailure(this.checkouts, checkoutPath, lease);
    }
    return lease;
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Git resource cache disposed');
  }
}

async function releaseLease<T>(lease: Promise<Lease<T>>): Promise<void> {
  try {
    await (await lease).release();
  } catch {}
}

function evictOnFailure<T>(cache: Map<string, Promise<T>>, key: string, lease: Promise<T>): void {
  lease.catch(() => {
    if (cache.get(key) === lease) cache.delete(key);
  });
}
