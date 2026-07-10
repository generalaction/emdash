import type {
  GitCheckoutsModel,
  GitRefsModel,
  GitRemotesModel,
  GitStashesModel,
  IGitRepository,
  RepositoryKey,
} from '@emdash/core/git';
import { createComputedState, reconcileDraft, type ComputedState } from '@emdash/core/lib';
import type { IWatchService, WatchHandle } from '@emdash/core/watch';
import { type Result, type Unsubscribe } from '@emdash/shared';
import { type LiveModelMutationCtx } from '@emdash/wire';
import { classifyGitWatchEvents, type WorktreeWatchEffects } from '../watch/classifier';
import type { RepositoryLiveHost, RepositoryLiveModels, RepositoryModel } from './live-models';
import { createRepositoryLiveModels } from './live-models';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

type RepositoryMutationCtx = LiveModelMutationCtx<RepositoryModel>;

export type CheckoutWatchRegistration = {
  gitDir: string;
  worktree: string;
  onEffects: (effects: WorktreeWatchEffects) => void;
};

export type RepositoryResourceOptions = {
  key: RepositoryKey;
  repository: IGitRepository;
  host: RepositoryLiveHost;
  watcher: IWatchService;
  onError?: (context: string, error: unknown) => void;
};

export class RepositoryResource {
  readonly key: RepositoryKey;
  readonly repository: IGitRepository;
  readonly instance: RepositoryLiveModels;
  readonly refs: ComputedState<GitRefsModel>;
  readonly remotes: ComputedState<GitRemotesModel>;
  readonly stashes: ComputedState<GitStashesModel>;
  readonly checkouts: ComputedState<GitCheckoutsModel>;

  private readonly commonDirWatch: WatchHandle;
  private readonly checkoutRegistrations = new Map<string, CheckoutWatchRegistration>();
  private readonly mutationQueue = new SerialQueue();

  static async create(options: RepositoryResourceOptions): Promise<RepositoryResource> {
    const remotes = await options.repository
      .getRemotes()
      .catch((): GitRemotesModel => ({ remotes: [] }));
    const [refs, stashes, checkouts] = await Promise.all([
      options.repository.getRefs().catch((): GitRefsModel => ({ branches: [], tags: [] })),
      options.repository.getStashes().catch((): GitStashesModel => ({ stashes: [] })),
      options.repository.listCheckouts().catch((): GitCheckoutsModel => []),
    ]);
    const instance = createRepositoryLiveModels(options.host, options.key, {
      refs,
      remotes,
      stashes,
      checkouts,
    });
    const resource = new RepositoryResource(options, instance);
    await resource.commonDirWatch.ready();
    return resource;
  }

  private constructor(options: RepositoryResourceOptions, instance: RepositoryLiveModels) {
    this.key = options.key;
    this.repository = options.repository;
    this.instance = instance;

    const onError = options.onError ?? (() => {});
    this.refs = createComputedState({
      compute: () => this.repository.getRefs(),
      apply: (fresh) => this.instance.states.refs.produce((draft) => reconcileDraft(draft, fresh)),
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`refs ${this.repository.gitCommonDir}`, error),
    });
    this.remotes = createComputedState({
      compute: () => this.repository.getRemotes(),
      apply: (fresh) =>
        this.instance.states.remotes.produce((draft) => reconcileDraft(draft, fresh)),
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`remotes ${this.repository.gitCommonDir}`, error),
    });
    this.stashes = createComputedState({
      compute: () => this.repository.getStashes(),
      apply: (fresh) =>
        this.instance.states.stashes.produce((draft) => reconcileDraft(draft, fresh)),
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`stashes ${this.repository.gitCommonDir}`, error),
    });
    this.checkouts = createComputedState({
      compute: () => this.repository.listCheckouts(),
      apply: (fresh) =>
        this.instance.states.checkouts.produce((draft) => reconcileDraft(draft, fresh)),
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`checkouts ${this.repository.gitCommonDir}`, error),
    });

    this.commonDirWatch = options.watcher.watch(
      this.repository.gitCommonDir,
      (events) => {
        const classification = classifyGitWatchEvents(events, this.layout());
        if (classification.repo.refs) this.refs.invalidate();
        if (classification.repo.remotes) this.remotes.invalidate();
        if (classification.repo.stashes) this.stashes.invalidate();
        if (classification.repo.checkouts) this.checkouts.invalidate();
        for (const [id, effects] of classification.worktrees) {
          this.checkoutRegistrations.get(id)?.onEffects(effects);
        }
      },
      {
        ignore: ['objects/**'],
        onResync: () => {
          this.refs.invalidate();
          this.remotes.invalidate();
          this.stashes.invalidate();
          this.checkouts.invalidate();
          for (const registration of this.checkoutRegistrations.values()) {
            registration.onEffects({ status: true, head: true });
          }
        },
      }
    );
  }

  registerCheckout(id: string, registration: CheckoutWatchRegistration): Unsubscribe {
    this.checkoutRegistrations.set(id, registration);
    return () => {
      if (this.checkoutRegistrations.get(id) === registration) {
        this.checkoutRegistrations.delete(id);
      }
    };
  }

  refreshRefs(ctx?: RepositoryMutationCtx): Promise<void> {
    return ctx
      ? this.refs.refreshInto((fresh) =>
          ctx.produce('refs', (draft) => reconcileDraft(draft, fresh))
        )
      : this.refs.refresh();
  }

  refreshRemotes(ctx?: RepositoryMutationCtx): Promise<void> {
    return ctx
      ? this.remotes.refreshInto((fresh) =>
          ctx.produce('remotes', (draft) => reconcileDraft(draft, fresh))
        )
      : this.remotes.refresh();
  }

  refreshStashes(ctx?: RepositoryMutationCtx): Promise<void> {
    return ctx
      ? this.stashes.refreshInto((fresh) =>
          ctx.produce('stashes', (draft) => reconcileDraft(draft, fresh))
        )
      : this.stashes.refresh();
  }

  refreshCheckouts(ctx?: RepositoryMutationCtx): Promise<void> {
    return ctx
      ? this.checkouts.refreshInto((fresh) =>
          ctx.produce('checkouts', (draft) => reconcileDraft(draft, fresh))
        )
      : this.checkouts.refresh();
  }

  runMutation<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return this.mutationQueue.run(fn);
  }

  async dispose(): Promise<void> {
    await this.commonDirWatch.release();
    this.refs.dispose();
    this.remotes.dispose();
    this.stashes.dispose();
    this.checkouts.dispose();
    this.checkoutRegistrations.clear();
    this.instance.dispose();
  }

  private layout() {
    return {
      gitCommonDir: this.repository.gitCommonDir,
      worktrees: [...this.checkoutRegistrations.entries()].map(([id, registration]) => ({
        id,
        gitDir: registration.gitDir,
        worktree: registration.worktree,
      })),
    };
  }
}

class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}
