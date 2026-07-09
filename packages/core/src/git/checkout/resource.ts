import path from 'node:path';
import { type Result } from '@emdash/shared';
import { type LiveModelMutationCtx, type LiveSource, LiveState } from '@emdash/wire';
import { createComputedState, reconcileDraft, type ComputedState } from '../../lib';
import type { IWatchService, WatchHandle } from '../../watch';
import type { RepositoryResource } from '../repository/resource';
import { classifyGitWatchEvents } from '../watch/classifier';
import type { CheckoutKey } from './key';
import type { CheckoutLiveHost, CheckoutLiveModels, CheckoutModel } from './live-models';
import { createCheckoutLiveModels } from './live-models';
import type { FileDiffStaleness, FileDiffStalenessReason } from './models/file-diff';
import type { GitHeadModel } from './models/head';
import type { CheckoutStatusModel } from './models/status';
import type { IGitCheckout } from './types';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

type CheckoutMutationCtx = LiveModelMutationCtx<CheckoutModel>;

type DiffStateEntry = {
  state: LiveState<FileDiffStaleness>;
  subscribers: number;
};

export type CheckoutResourceOptions = {
  key: CheckoutKey;
  checkout: IGitCheckout;
  repository: RepositoryResource;
  host: CheckoutLiveHost;
  watcher: IWatchService;
  onError?: (context: string, error: unknown) => void;
};

export class CheckoutResource {
  readonly key: CheckoutKey;
  readonly checkout: IGitCheckout;
  readonly repository: RepositoryResource;
  readonly instance: CheckoutLiveModels;
  readonly status: ComputedState<CheckoutStatusModel>;
  readonly head: ComputedState<GitHeadModel>;

  private readonly worktreeWatch: WatchHandle;
  private readonly unregisterFromRepository: () => void;
  private readonly diffStates = new Map<string, DiffStateEntry>();
  private readonly mutationQueue = new SerialQueue();

  static async create(options: CheckoutResourceOptions): Promise<CheckoutResource> {
    const [status, head] = await Promise.all([
      options.checkout.getStatus(),
      options.checkout.getHead(),
    ]);
    const instance = createCheckoutLiveModels(options.host, options.key, { status, head });
    const resource = new CheckoutResource(options, instance);
    await resource.worktreeWatch.ready();
    return resource;
  }

  private constructor(options: CheckoutResourceOptions, instance: CheckoutLiveModels) {
    this.key = options.key;
    this.checkout = options.checkout;
    this.repository = options.repository;
    this.instance = instance;

    const onError = options.onError ?? (() => {});
    this.status = createComputedState({
      compute: () => this.checkout.getStatus(),
      apply: (fresh) =>
        this.instance.states.status.produce((draft) => reconcileDraft(draft, fresh)),
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`status ${this.checkout.checkoutPath}`, error),
    });
    this.head = createComputedState({
      compute: () => this.checkout.getHead(),
      apply: (fresh) => this.instance.states.head.produce((draft) => reconcileDraft(draft, fresh)),
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`head ${this.checkout.checkoutPath}`, error),
    });

    this.unregisterFromRepository = this.repository.registerCheckout(this.checkout.checkoutPath, {
      gitDir: this.checkout.gitDir,
      worktree: this.checkout.checkoutPath,
      onEffects: (effects) => {
        if (effects.status) {
          this.status.invalidate();
          this.bumpAllDiffStates('index-changed');
        }
        if (effects.head) {
          this.head.invalidate();
          this.bumpAllDiffStates('ref-changed');
        }
      },
    });

    this.worktreeWatch = options.watcher.watch(
      this.checkout.checkoutPath,
      (events) => {
        const classification = classifyGitWatchEvents(events, {
          gitCommonDir: this.repository.repository.gitCommonDir,
          worktrees: [
            {
              id: 'self',
              gitDir: this.checkout.gitDir,
              worktree: this.checkout.checkoutPath,
            },
          ],
        });
        const effects = classification.worktrees.get('self');
        if (effects?.status) this.status.invalidate();
        if (effects?.head) this.head.invalidate();

        for (const event of events) {
          this.bumpDiffState(this.toRelativePath(event.path), 'content-changed');
        }
      },
      {
        ignore: ['.git/**'],
        onResync: () => {
          this.status.invalidate();
          this.head.invalidate();
          this.bumpAllDiffStates('content-changed');
        },
      }
    );
  }

  fileDiffStaleness(filePath: string): LiveSource {
    const relativePath = this.toRelativePath(filePath);
    return {
      snapshot: () => this.ensureDiffState(relativePath).state.snapshot(),
      subscribe: (listener) => {
        const entry = this.ensureDiffState(relativePath);
        entry.subscribers += 1;
        const off = entry.state.subscribe(listener);
        return () => {
          off();
          entry.subscribers -= 1;
          if (entry.subscribers <= 0 && this.diffStates.get(relativePath) === entry) {
            this.diffStates.delete(relativePath);
          }
        };
      },
    };
  }

  refreshStatus(ctx?: CheckoutMutationCtx): Promise<void> {
    return ctx
      ? this.status.refreshInto((fresh) =>
          ctx.produce('status', (draft) => reconcileDraft(draft, fresh))
        )
      : this.status.refresh();
  }

  refreshHead(ctx?: CheckoutMutationCtx): Promise<void> {
    return ctx
      ? this.head.refreshInto((fresh) =>
          ctx.produce('head', (draft) => reconcileDraft(draft, fresh))
        )
      : this.head.refresh();
  }

  runMutation<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return this.mutationQueue.run(fn);
  }

  async dispose(): Promise<void> {
    this.unregisterFromRepository();
    await this.worktreeWatch.release();
    this.status.dispose();
    this.head.dispose();
    this.diffStates.clear();
    this.instance.dispose();
  }

  bumpAllDiffStates(reason: FileDiffStalenessReason): void {
    for (const relativePath of this.diffStates.keys()) {
      this.bumpDiffState(relativePath, reason);
    }
  }

  private ensureDiffState(relativePath: string): DiffStateEntry {
    let entry = this.diffStates.get(relativePath);
    if (!entry) {
      entry = { state: new LiveState<FileDiffStaleness>({ revision: 0 }), subscribers: 0 };
      this.diffStates.set(relativePath, entry);
    }
    return entry;
  }

  private bumpDiffState(relativePath: string, reason: FileDiffStalenessReason): void {
    const entry = this.diffStates.get(relativePath);
    if (!entry) return;
    entry.state.produce((draft) => {
      draft.revision += 1;
      draft.lastReason = reason;
    });
  }

  private toRelativePath(filePath: string): string {
    if (!path.isAbsolute(filePath) && !path.win32.isAbsolute(filePath)) return filePath;
    return path.relative(this.checkout.checkoutPath, filePath).replace(/\\/g, '/');
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
