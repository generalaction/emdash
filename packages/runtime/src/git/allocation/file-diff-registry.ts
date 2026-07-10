import path from 'node:path';
import type {
  BoundFileDiffKey,
  FileDiffStalenessReason,
  NormalizedDiffTarget,
} from '@emdash/core/git';
import type { PendingLease } from '@emdash/shared';
import { LiveState, type LiveSource } from '@emdash/wire';

export type FileDiffRegistryOptions = Readonly<{
  checkoutRoot: string;
  maxEntries?: number;
}>;

type Entry = {
  readonly relativePath: string;
  readonly target: NormalizedDiffTarget;
  readonly state: LiveState<{ revision: number; lastReason?: FileDiffStalenessReason }>;
  leases: number;
  lastUsed: number;
};

const DEFAULT_MAX_ENTRIES = 256;

/** Bounded registry of cheap, target-aware invalidation signals for on-demand file diffs. */
export class FileDiffRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private disposed = false;

  constructor(private readonly options: FileDiffRegistryOptions) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  acquire(key: BoundFileDiffKey): PendingLease<LiveSource> {
    if (this.disposed) throw new Error('FileDiffRegistry is disposed');
    const relativePath = this.toRelativePath(key.filePath);
    const id = entryId(relativePath, key.target);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        relativePath,
        target: key.target,
        state: new LiveState({ revision: 0 }),
        leases: 0,
        lastUsed: Date.now(),
      };
      this.entries.set(id, entry);
    }
    entry.leases += 1;
    entry.lastUsed = Date.now();
    this.evictIdleEntries();

    let released = false;
    return {
      ready: async () => entry.state,
      release: async () => {
        if (released) return;
        released = true;
        entry.leases = Math.max(0, entry.leases - 1);
        entry.lastUsed = Date.now();
        this.evictIdleEntries();
      },
    };
  }

  bump(paths: 'all' | readonly string[], reason: FileDiffStalenessReason): void {
    if (this.disposed) return;
    const selected =
      paths === 'all' ? undefined : new Set(paths.map((filePath) => this.toRelativePath(filePath)));
    for (const entry of this.entries.values()) {
      if (selected && !selected.has(entry.relativePath)) continue;
      if (reason === 'ref-changed' && !dependsOnMutableRef(entry.target)) continue;
      entry.state.produce((draft) => {
        draft.revision += 1;
        draft.lastReason = reason;
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.state.dispose();
    this.entries.clear();
  }

  private toRelativePath(filePath: string): string {
    const absolutePath = path.resolve(this.options.checkoutRoot, filePath);
    const relativePath = path.relative(this.options.checkoutRoot, absolutePath);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Path is outside checkout: ${filePath}`);
    }
    return relativePath.replace(/\\/g, '/');
  }

  private evictIdleEntries(): void {
    if (this.entries.size <= this.maxEntries) return;
    const idle = [...this.entries.entries()]
      .filter(([, entry]) => entry.leases === 0)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [id, entry] of idle) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(id);
      entry.state.dispose();
    }
  }
}

function entryId(relativePath: string, target: NormalizedDiffTarget): string {
  return JSON.stringify([relativePath, target]);
}

function dependsOnMutableRef(target: NormalizedDiffTarget): boolean {
  switch (target.kind) {
    case 'working-vs-head':
    case 'staged-vs-head':
      return true;
    case 'working-vs-ref':
      return target.ref.kind !== 'commit';
    case 'merge-base':
      return target.base.kind !== 'commit' || target.head.kind !== 'commit';
  }
}
