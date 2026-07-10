import type { FileContentModel } from '@emdash/core/files';
import { ComputedLiveState, type LiveCursor, type LiveSource } from '@emdash/wire';
import type { ContentIdentity } from '../allocation/identity';
import type { RootChange, RootResource } from '../root/root-resource';
import { ContentReader } from './content-reader';

const CONTENT_REVALIDATE_MS = 5 * 60_000;
const CONTENT_DEBOUNCE_MS = 25;

export type ContentResourceOptions = {
  identity: ContentIdentity;
  root: RootResource;
  maxBytes?: number;
  onError?: (context: string, error: unknown) => void;
};

export class ContentResource {
  readonly identity: ContentIdentity;

  private readonly computed: ComputedLiveState<FileContentModel>;
  private readonly unsubscribeRoot: () => void;
  private disposed = false;

  constructor(options: ContentResourceOptions) {
    this.identity = options.identity;
    const reader = new ContentReader(options.root.paths, options.maxBytes);
    this.computed = new ComputedLiveState({
      compute: () => reader.read(options.identity.path),
      debounceMs: CONTENT_DEBOUNCE_MS,
      revalidateIntervalMs: CONTENT_REVALIDATE_MS,
      onError: (error) => options.onError?.(`files content ${options.identity.contentId}`, error),
    });
    this.unsubscribeRoot = options.root.subscribe((changes) => this.onRootChanges(changes));
  }

  state(): Promise<LiveSource> {
    this.assertActive();
    return this.computed.prepare();
  }

  invalidate(): void {
    this.computed.invalidate();
  }

  refresh(options?: { mutationId?: string }): Promise<LiveCursor> {
    return this.computed.refresh(options);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeRoot();
    this.computed.dispose();
  }

  private onRootChanges(changes: RootChange[]): void {
    if (changes.some((change) => affectsContent(change, this.identity.path))) this.invalidate();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('ContentResource is disposed');
  }
}

function affectsContent(change: RootChange, contentPath: string): boolean {
  if (change.kind === 'resync') return true;
  if (change.path === '') return true;
  if (change.path === contentPath) return true;
  return contentPath.startsWith(`${change.path}/`);
}
