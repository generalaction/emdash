import type { Scope } from '@emdash/shared/concurrency';
import { cell, type Cell } from '@emdash/wire/state';
import type { PortableRelativePath } from '#primitives/path/api';
import type {
  BoundFileDiffKey,
  FileDiffStalenessReason,
  NormalizedDiffTarget,
} from '#runtimes/git/api';

export type FileDiffRegistryOptions = Readonly<{
  maxEntries?: number;
}>;

type Entry = {
  readonly relativePath: PortableRelativePath;
  readonly target: NormalizedDiffTarget;
  readonly state: Cell<{ revision: number; lastReason?: FileDiffStalenessReason }>;
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

  state(
    key: BoundFileDiffKey,
    scope: Scope
  ): Cell<{ revision: number; lastReason?: FileDiffStalenessReason }> {
    if (this.disposed) throw new Error('FileDiffRegistry is disposed');
    const relativePath = key.filePath;
    const id = entryId(relativePath, key.target);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        relativePath,
        target: key.target,
        state: cell({ revision: 0 }),
        leases: 0,
        lastUsed: Date.now(),
      };
      this.entries.set(id, entry);
    }
    entry.leases += 1;
    entry.lastUsed = Date.now();
    this.evictIdleEntries();

    scope.add(() => this.release(entry));
    return entry.state;
  }

  bump(paths: 'all' | readonly PortableRelativePath[], reason: FileDiffStalenessReason): void {
    if (this.disposed) return;
    const selected = paths === 'all' ? undefined : new Set(paths);
    for (const entry of this.entries.values()) {
      if (selected && !selected.has(entry.relativePath)) continue;
      if (reason === 'ref-changed' && !dependsOnMutableRef(entry.target)) continue;
      entry.state.update((previous) => ({
        revision: previous.revision + 1,
        lastReason: reason,
      }));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.entries.clear();
  }

  private release(entry: Entry): void {
    entry.leases = Math.max(0, entry.leases - 1);
    entry.lastUsed = Date.now();
    this.evictIdleEntries();
  }

  private evictIdleEntries(): void {
    if (this.entries.size <= this.maxEntries) return;
    const idle = [...this.entries.entries()]
      .filter(([, entry]) => entry.leases === 0)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [id] of idle) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(id);
    }
  }
}

function entryId(relativePath: PortableRelativePath, target: NormalizedDiffTarget): string {
  return JSON.stringify([relativePath, target]);
}

function dependsOnMutableRef(target: NormalizedDiffTarget): boolean {
  switch (target.kind) {
    case 'working-vs-head':
    case 'working-vs-index':
    case 'staged-vs-head':
      return true;
    case 'working-vs-ref':
      return target.ref.kind !== 'commit';
    case 'merge-base':
      return target.base.kind !== 'commit' || target.head.kind !== 'commit';
  }
}
