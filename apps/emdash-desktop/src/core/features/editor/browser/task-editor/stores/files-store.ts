import {
  canonicalExclusionPatterns,
  DEFAULT_TREE_EXCLUDE,
  ExclusionPolicy,
} from '@emdash/core/primitives/exclusion-policy/api';
import type { HostRef } from '@emdash/core/primitives/host/api';
import {
  encodeResourceUri,
  hostFileRef,
  ROOT_RELATIVE_PATH,
  type HostAbsolutePath,
  type PortableRelativePath,
  type ResourceUri,
} from '@emdash/core/primitives/path/api';
import {
  isExpandableListingEntry,
  type FolderListing,
  type FsError,
  type ListingEntry,
} from '@emdash/core/runtimes/files/api';
import { protocolUpgradeMessage } from '@emdash/core/workspace-server';
import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, pin, remote, type RemoteModel, type Snapshot } from '@emdash/wire/state';
import { comparer, computed, makeObservable, observable, reaction, runInAction, when } from 'mobx';
import {
  isExpandableFileTreeNode,
  normalizeFileTreePath,
  sortFileNodes,
  toRenderableFileNode,
  type FileNodeId,
  type RenderableFileNode,
} from '@core/features/editor/api/browser/file-tree/tree-utils';
import { filesWireContract } from '@core/features/files/api';
import { getFilesClient, type FilesClient } from '@core/features/files/api/browser/client';
import {
  classifyLiveRuntimeObservation,
  type LiveRuntimeObservation,
} from '@core/features/projects/api/browser/live-runtime-observation';
import type { ProjectHostAccess } from '@core/features/projects/api/browser/stores/project-context';
import {
  absoluteRuntimePath,
  hostFileRefFromNativePath,
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
  relativePathWithin,
  resolveRelativePath,
} from '@core/primitives/desktop-runtime/api';

type ListingModel = typeof filesWireContract.listing;
type ListingRemote = RemoteModel<ListingModel>;
type ListingMember = ReturnType<ListingRemote>;

export type TreeMutationError =
  | FsError
  | {
      type: string;
      message?: string;
      path?: string;
      paths?: readonly string[];
      host?: unknown;
    }
  | { type: 'unavailable'; message: string };

/** What one subscribed folder currently shows. */
export type FolderView =
  | { status: 'loading' }
  | { status: 'ready'; entries: Readonly<Record<string, ListingEntry>> }
  | { status: 'error'; message: string };

type PendingUploadNode = { node: RenderableFileNode };
type FolderSubscription = { scope: Scope; member: ListingMember };
type ViewData = {
  nodes: Map<string, RenderableFileNode>;
  rootNodes: RenderableFileNode[];
  childrenById: Map<FileNodeId | null, RenderableFileNode[]>;
  loadedPaths: Set<string>;
  pathToId: Map<string, FileNodeId>;
};

const LISTING_LINGER_MS = 15_000;

/**
 * One task view's projection of a workspace's file tree. The host keeps a
 * shared, watched listing per folder; this store subscribes to exactly the
 * folders the view shows (the root and every open folder whose parents are
 * open), and derives rows, exclusions and pending uploads from those listings.
 * Collapsing a folder releases its subscription; reopening it shortly after is
 * served from the lingering replica.
 */
export class FilesStore {
  private readonly root: HostAbsolutePath;
  private readonly host: HostRef;
  /** The workspace root's serialized identity — the scope key for buffer restore and the tree. */
  readonly rootUri: ResourceUri;
  private runtimeScope: Scope | null = null;
  private listingRemote: ListingRemote | null = null;
  private bound = false;
  private startPromise: Promise<void> | null = null;
  private started = false;
  private syncError: string | null = null;
  private exclusions = canonicalExclusionPatterns(DEFAULT_TREE_EXCLUDE);
  private expandedPaths: ReadonlySet<string> = new Set();
  private nextPendingUploadId = 1;
  private policyCache: { patterns: readonly string[]; policy: ExclusionPolicy } | null = null;
  private disposeDemand: (() => void) | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposeHostReaction: () => void;

  // Shallow: listings are immutable replica values whose identity the projection caches rely on.
  private readonly folders = observable.map<PortableRelativePath, FolderView>({}, { deep: false });
  /** Folders held open while a reveal waits for them, counted per in-flight reveal. */
  private readonly revealing = observable.map<PortableRelativePath, number>();
  private readonly subscriptions = new Map<PortableRelativePath, FolderSubscription>();
  private readonly pendingUploadNodes = observable.map<FileNodeId, PendingUploadNode>();
  // Projection caches: unchanged listing entries keep their node, and unchanged
  // listings their sorted, filtered child list.
  private readonly renderableNodes = new WeakMap<ListingEntry, RenderableFileNode>();
  private readonly childLists = new WeakMap<
    Readonly<Record<string, ListingEntry>>,
    { exclusions: readonly string[]; nodes: RenderableFileNode[] }
  >();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly workspacePath: string,
    sshConnectionId?: string,
    readonly hostAccess?: ProjectHostAccess
  ) {
    // Workspace→root resolution happens here at the renderer edge (spec §2/§8):
    // listings are keyed by the root's ResourceUri, never by workspaceId.
    const rootRef = hostFileRefFromNativePath(workspacePath, sshConnectionId);
    this.root = rootRef.path;
    this.host = rootRef.host;
    this.rootUri = encodeResourceUri(rootRef);
    makeObservable<
      FilesStore,
      'bound' | 'syncError' | 'exclusions' | 'expandedPaths' | 'viewData' | 'demand'
    >(this, {
      bound: observable,
      syncError: observable,
      exclusions: observable.ref,
      expandedPaths: observable.ref,
      viewData: computed,
      demand: computed({ equals: comparer.structural }),
      pendingPaths: computed,
      directoryErrors: computed,
      isLoading: computed,
      error: computed,
      observation: computed,
    });
    this.disposeHostReaction = reaction(
      () => this.hostAccess?.state,
      (state) => {
        if (state === undefined || state.kind !== 'ready' || !this.started) return;
        if (!this.bound) {
          void this.ensureStarted();
          return;
        }
        // Reattach after the host connection recovered.
        for (const { member } of this.subscriptions.values()) {
          void member.states.listing.refresh().catch(() => {});
        }
      }
    );
  }

  get nodes(): Map<string, RenderableFileNode> {
    return this.viewData.nodes;
  }

  get rootNodes(): RenderableFileNode[] {
    return this.viewData.rootNodes;
  }

  get childrenById(): Map<FileNodeId | null, RenderableFileNode[]> {
    return this.viewData.childrenById;
  }

  get loadedPaths(): Set<string> {
    return this.viewData.loadedPaths;
  }

  /** Folders whose listing is still on its way. */
  get pendingPaths(): ReadonlySet<string> {
    const pending = new Set<string>();
    for (const [path, view] of this.folders) {
      if (view.status === 'loading') pending.add(this.absolute(path));
    }
    return pending;
  }

  /** Folders that could not be listed, with the reason shown on their row. */
  get directoryErrors(): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();
    for (const [path, view] of this.folders) {
      if (view.status === 'error') errors.set(this.absolute(path), view.message);
    }
    return errors;
  }

  get isLoading(): boolean {
    const root = this.folders.get(ROOT_RELATIVE_PATH);
    if (this.hostAccess?.liveAction.kind === 'disabled' && root?.status !== 'ready') return false;
    if (this.syncError !== null) return false;
    return root === undefined || root.status === 'loading';
  }

  get error(): string | undefined {
    if (this.syncError !== null) return this.syncError;
    const root = this.folders.get(ROOT_RELATIVE_PATH);
    return root?.status === 'error' ? root.message : undefined;
  }

  get observation(): LiveRuntimeObservation<FolderView> {
    const root = this.folders.get(ROOT_RELATIVE_PATH);
    return classifyLiveRuntimeObservation(
      this.hostAccess?.state ?? { kind: 'ready', hostGeneration: 0 },
      root?.status === 'ready' ? root : undefined
    );
  }

  get rootPath(): string {
    return normalizeFileTreePath(this.workspacePath);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    await this.ensureStarted();
  }

  dispose(): void {
    this.disposeHostReaction();
    this.started = false;
    this.unbind();
    runInAction(() => {
      this.pendingUploadNodes.clear();
      this.revealing.clear();
    });
  }

  /** Exclusions only filter the projection; no listing is reread. */
  setExclusions(patterns: readonly string[] | undefined): void {
    const next = canonicalExclusionPatterns(patterns ?? DEFAULT_TREE_EXCLUDE);
    if (this.exclusions.join('\0') === next.join('\0')) return;
    runInAction(() => {
      this.exclusions = next;
    });
  }

  /** The view's open folders; the store subscribes to the ones that are visible. */
  setExpandedPaths(paths: Iterable<string>): void {
    const next = new Set([...paths].map(normalizeFileTreePath));
    runInAction(() => {
      this.expandedPaths = next;
    });
  }

  /** Rereads one folder (and listed folders beneath it) on the host, e.g. after a failed read. */
  async retry(path: string): Promise<Result<void, TreeMutationError>> {
    try {
      return await this.refreshFolder(this.relative(this.resolveWorkspacePath(path)));
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  /** Rereads every listed folder of the workspace, reconnecting first if the tree never bound. */
  async refresh(): Promise<Result<void, TreeMutationError>> {
    if (!this.bound) {
      this.startPromise = null;
      await this.ensureStarted();
      return this.syncError === null
        ? ok<void>()
        : err({ type: 'unavailable', message: this.syncError });
    }
    return this.refreshFolder(ROOT_RELATIVE_PATH);
  }

  /**
   * Opens the folders on the way to `filePath`, all at once, and waits for their
   * listings. Resolves to the absolute folders the view must expand.
   */
  async revealFile(
    filePath: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<Result<string[], TreeMutationError>> {
    let target: PortableRelativePath;
    try {
      target = this.relative(this.resolveWorkspacePath(filePath));
    } catch (error) {
      return err(treeMutationError(error));
    }
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      return err({
        type: 'unavailable',
        message: 'Live actions are unavailable for this Project.',
      });
    }
    await this.ensureStarted();
    if (!this.bound) {
      return err({ type: 'unavailable', message: this.syncError ?? 'File tree is unavailable' });
    }
    const folders = folderChain(target);
    runInAction(() => {
      for (const folder of folders)
        this.revealing.set(folder, (this.revealing.get(folder) ?? 0) + 1);
    });
    try {
      await when(
        () =>
          folders.every((folder) => (this.folders.get(folder)?.status ?? 'loading') !== 'loading'),
        { signal: options.signal }
      );
      const segments = target.split('/');
      for (const [index, folder] of folders.entries()) {
        const view = this.folders.get(folder);
        if (view?.status === 'error') return err({ type: 'unavailable', message: view.message });
        const child = segments[index]!;
        if (view?.status !== 'ready' || !Object.hasOwn(view.entries, child)) {
          return err({ type: 'not-found', path: target });
        }
      }
      return ok(folders.slice(1).map((folder) => this.absolute(folder)));
    } catch (error) {
      return err(treeMutationError(options.signal?.aborted ? options.signal.reason : error));
    } finally {
      runInAction(() => {
        for (const folder of folders) {
          const count = (this.revealing.get(folder) ?? 1) - 1;
          if (count > 0) this.revealing.set(folder, count);
          else this.revealing.delete(folder);
        }
      });
    }
  }

  createFile(path: string): Promise<Result<void, TreeMutationError>> {
    return this.runFsMutation((client) => client.fs.createFile({ uri: this.uriFor(path) }));
  }

  createDirectory(path: string): Promise<Result<void, TreeMutationError>> {
    return this.runFsMutation((client) => client.fs.createDirectory({ uri: this.uriFor(path) }));
  }

  deleteEntry(path: string, recursive = false): Promise<Result<void, TreeMutationError>> {
    return this.runFsMutation((client) => client.fs.delete({ uri: this.uriFor(path), recursive }));
  }

  rename(path: string, nextName: string): Promise<Result<void, TreeMutationError>> {
    const absolute = this.resolveWorkspacePath(path);
    const parent = parentPathFromPath(absolute) ?? this.rootPath;
    const nextPath = normalizeFileTreePath(`${parent}/${nextName}`);
    return this.runFsMutation((client) =>
      client.fs.rename({ from: this.uriFor(absolute), to: this.uriFor(nextPath) })
    );
  }

  move(
    sourcePath: string,
    targetDirPath: string,
    newName?: string
  ): Promise<Result<void, TreeMutationError>> {
    const source = this.resolveWorkspacePath(sourcePath);
    const targetDir = this.resolveWorkspacePath(targetDirPath);
    const target = normalizeFileTreePath(`${targetDir}/${newName ?? basenameFromPath(source)}`);
    return this.runFsMutation((client) =>
      client.fs.move({ from: this.uriFor(source), to: this.uriFor(target) })
    );
  }

  copy(
    sourcePath: string,
    targetDirPath: string,
    newName?: string
  ): Promise<Result<void, TreeMutationError>> {
    const source = this.resolveWorkspacePath(sourcePath);
    const targetDir = this.resolveWorkspacePath(targetDirPath);
    const target = normalizeFileTreePath(`${targetDir}/${newName ?? basenameFromPath(source)}`);
    return this.runFsMutation((client) =>
      client.fs.copy({ from: this.uriFor(source), to: this.uriFor(target) })
    );
  }

  /** Shows rows for files being uploaded until the live listing contains them. */
  addOptimisticNodes(nodes: Array<{ path: string; type: 'file' | 'directory' }>): string[] {
    const inserted: string[] = [];
    runInAction(() => {
      for (const candidate of nodes) {
        const absolute = this.resolveWorkspacePath(candidate.path);
        if (this.viewData.nodes.has(absolute) || this.pendingUploadNodeForPath(absolute)) continue;
        const parentPath = parentPathFromPath(absolute) ?? this.rootPath;
        if (!this.viewData.loadedPaths.has(parentPath)) continue;
        const parentId =
          parentPath === this.rootPath ? null : this.viewData.pathToId.get(parentPath);
        if (parentPath !== this.rootPath && parentId === undefined) continue;
        const name = basenameFromPath(absolute);
        const id = `pending-upload:${this.nextPendingUploadId++}`;
        this.pendingUploadNodes.set(id, {
          node: {
            id,
            path: absolute,
            name,
            parentId: parentId ?? null,
            parentPath,
            depth: this.relative(absolute).split('/').length - 1,
            type: candidate.type,
            isHidden: name.startsWith('.'),
            extension:
              candidate.type === 'file' && name.includes('.') ? name.split('.').pop() : undefined,
          },
        });
        inserted.push(absolute);
      }
    });
    return inserted;
  }

  removeNode(path: string): void {
    const id = this.pendingUploadNodeForPath(this.resolveWorkspacePath(path));
    if (id) runInAction(() => this.pendingUploadNodes.delete(id));
  }

  /** The policy for the current exclusions, rebuilt only when they change. */
  private get exclusionPolicy(): ExclusionPolicy {
    const patterns = this.exclusions;
    if (this.policyCache?.patterns !== patterns) {
      this.policyCache = { patterns, policy: new ExclusionPolicy(patterns) };
    }
    return this.policyCache.policy;
  }

  /** Whether the tree's exclusion patterns hide `path` or one of its folders. */
  isTreeExcluded(path: string): boolean {
    try {
      return this.exclusionPolicy.excludes(this.relative(this.resolveWorkspacePath(path)));
    } catch {
      return false;
    }
  }

  /**
   * The folders to subscribe to, found by walking down from the root through open
   * folders. A folder is open when it is expanded, or when it is the lone
   * subfolder of an open folder: the tree compacts such a chain into one row that
   * is open while its first folder is. A remembered folder loads alongside its
   * parent until the parent's listing shows it no longer exists. Folders an
   * in-flight reveal waits for are added on top.
   */
  private get demand(): PortableRelativePath[] {
    const policy = this.exclusionPolicy;
    const expandedByParent = new Map<PortableRelativePath, PortableRelativePath[]>();
    for (const path of this.expandedPaths) {
      const relative = this.relativeOrNull(path);
      if (!relative || policy.excludes(relative)) continue;
      const parent = parentOf(relative);
      expandedByParent.set(parent, [...(expandedByParent.get(parent) ?? []), relative]);
    }
    const wanted = new Set<PortableRelativePath>();
    const pending: PortableRelativePath[] = [ROOT_RELATIVE_PATH];
    while (pending.length > 0) {
      const folder = pending.pop()!;
      if (wanted.has(folder)) continue;
      wanted.add(folder);
      const view = this.folders.get(folder);
      const entries = view?.status === 'ready' ? view.entries : undefined;
      for (const child of expandedByParent.get(folder) ?? []) {
        const name = basenameFromPath(child);
        const entry = entries && Object.hasOwn(entries, name) ? entries[name] : undefined;
        if (!entries || (entry && isExpandableListingEntry(entry))) pending.push(child);
      }
      if (!entries) continue;
      const children = this.childNodes(folder, entries);
      if (children.length === 1 && children[0]!.type === 'directory') {
        pending.push(portablePath(children[0]!.id));
      }
    }
    for (const path of this.revealing.keys()) wanted.add(path);
    return [...wanted].sort();
  }

  private get viewData(): ViewData {
    const nodes = new Map<string, RenderableFileNode>();
    const childrenById = new Map<FileNodeId | null, RenderableFileNode[]>();
    const loadedPaths = new Set<string>();
    const pathToId = new Map<string, FileNodeId>();
    const visit = (folder: PortableRelativePath, parentId: FileNodeId | null) => {
      const view = this.folders.get(folder);
      if (view?.status !== 'ready') return;
      loadedPaths.add(this.absolute(folder));
      const children = this.childNodes(folder, view.entries);
      childrenById.set(parentId, children);
      for (const node of children) {
        nodes.set(node.path, node);
        pathToId.set(node.path, node.id);
        if (isExpandableFileTreeNode(node)) visit(portablePath(node.id), node.id);
      }
    };
    visit(ROOT_RELATIVE_PATH, null);
    for (const { node } of this.pendingUploadNodes.values()) {
      if (nodes.has(node.path)) continue;
      const parentPath = parentPathFromPath(node.path) ?? this.rootPath;
      if (!loadedPaths.has(parentPath)) continue;
      nodes.set(node.path, node);
      pathToId.set(node.path, node.id);
      // Copy rather than mutate: the listed children may be a cached list.
      const siblings = childrenById.get(node.parentId) ?? [];
      childrenById.set(node.parentId, sortFileNodes([...siblings, node]));
    }
    return {
      nodes,
      childrenById,
      loadedPaths,
      pathToId,
      rootNodes: childrenById.get(null) ?? [],
    };
  }

  /** The folder's visible children, sorted; reused while its listing and the exclusions hold. */
  private childNodes(
    folder: PortableRelativePath,
    entries: Readonly<Record<string, ListingEntry>>
  ): RenderableFileNode[] {
    const exclusions = this.exclusions;
    const cached = this.childLists.get(entries);
    if (cached?.exclusions === exclusions) return cached.nodes;
    const policy = this.exclusionPolicy;
    const nodes: RenderableFileNode[] = [];
    for (const [name, entry] of Object.entries(entries)) {
      const path = folder ? `${folder}/${name}` : name;
      if (policy.excludes(portablePath(path))) continue;
      let node = this.renderableNodes.get(entry);
      if (!node) {
        node = toRenderableFileNode({ path, name, entry }, this.rootPath);
        this.renderableNodes.set(entry, node);
      }
      nodes.push(node);
    }
    const sorted = sortFileNodes(nodes);
    this.childLists.set(entries, { exclusions, nodes: sorted });
    return sorted;
  }

  private ensureStarted(): Promise<void> {
    this.startPromise ??= this.bind();
    return this.startPromise;
  }

  private async bind(): Promise<void> {
    try {
      const client = await getFilesClient();
      if (!this.started) return;
      const scope = createScope({ label: `files-store:${this.workspaceId}` });
      const listingRemote = remote(filesWireContract.listing, client.listing, {
        scope,
        lingerMs: LISTING_LINGER_MS,
      });
      this.runtimeScope = scope;
      this.listingRemote = listingRemote;
      runInAction(() => {
        this.bound = true;
        this.syncError = null;
      });
      this.disposeDemand = reaction(
        () => this.demand,
        (paths) => this.syncSubscriptions(paths),
        { fireImmediately: true }
      );
    } catch (error) {
      runInAction(() => {
        this.syncError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private syncSubscriptions(paths: readonly PortableRelativePath[]): void {
    for (const path of paths) {
      if (!this.subscriptions.has(path)) this.subscribe(path);
    }
    // Release on the next tick: a reveal hands its folders over to the view's
    // expansion right after it settles, and that brief gap must not drop rows.
    if (this.releaseTimer !== null || this.subscriptions.size === paths.length) return;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      const wanted = new Set(this.demand);
      for (const path of [...this.subscriptions.keys()]) {
        if (!wanted.has(path)) this.unsubscribe(path);
      }
    }, 0);
  }

  private subscribe(path: PortableRelativePath): void {
    const remoteModel = this.listingRemote;
    const runtimeScope = this.runtimeScope;
    if (!remoteModel || !runtimeScope) return;
    const scope = runtimeScope.child(`listing:${path}`);
    const member = remoteModel({ root: this.rootUri, path });
    this.subscriptions.set(path, { scope, member });
    observe(
      member.states.listing,
      (snapshot) => {
        if (this.subscriptions.get(path)?.member !== member) return;
        runInAction(() => this.folders.set(path, folderView(snapshot)));
      },
      { scope, immediate: true }
    );
    pin(scope, [member.states.listing]);
  }

  private unsubscribe(path: PortableRelativePath): void {
    const subscription = this.subscriptions.get(path);
    if (!subscription) return;
    this.subscriptions.delete(path);
    void subscription.scope.dispose();
    runInAction(() => this.folders.delete(path));
  }

  private unbind(): void {
    this.disposeDemand?.();
    this.disposeDemand = null;
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    const scope = this.runtimeScope;
    const listingRemote = this.listingRemote;
    this.runtimeScope = null;
    this.listingRemote = null;
    this.subscriptions.clear();
    this.startPromise = null;
    runInAction(() => {
      this.bound = false;
      this.syncError = null;
      this.folders.clear();
    });
    void (async () => {
      try {
        await listingRemote?.dispose();
      } finally {
        await scope?.dispose();
      }
    })();
  }

  private async refreshFolder(
    path: PortableRelativePath
  ): Promise<Result<void, TreeMutationError>> {
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      return err({
        type: 'unavailable',
        message: 'Live actions are unavailable for this Project.',
      });
    }
    await this.ensureStarted();
    const listingRemote = this.listingRemote;
    if (!listingRemote) {
      return err({ type: 'unavailable', message: this.syncError ?? 'File tree is unavailable' });
    }
    try {
      const member =
        this.subscriptions.get(path)?.member ?? listingRemote({ root: this.rootUri, path });
      const invocation = await member.mutations.refresh(undefined);
      if (!invocation.result.success) return invocation.result;
      await invocation.settled;
      return ok<void>();
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  /**
   * Stateless fs verbs keyed by the entry's ResourceUri (spec §3.4). The files
   * runtime reflects successful mutations into the live listings at ack time,
   * so no renderer-side optimistic recipe is needed.
   */
  private async runFsMutation<T>(
    run: (client: FilesClient) => Promise<Result<T, TreeMutationError>>
  ): Promise<Result<void, TreeMutationError>> {
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      return err({
        type: 'unavailable',
        message: 'Live actions are unavailable for this Project.',
      });
    }
    try {
      const client = await getFilesClient();
      const result = await run(client);
      return result.success ? ok<void>() : result;
    } catch (error) {
      return err(treeMutationError(error));
    }
  }

  private uriFor(path: string): ResourceUri {
    return encodeResourceUri(
      hostFileRef(this.host, hostPathFromNative(this.resolveWorkspacePath(path)))
    );
  }

  private pendingUploadNodeForPath(path: string): FileNodeId | undefined {
    for (const [id, pending] of this.pendingUploadNodes) {
      if (pending.node.path === path) return id;
    }
    return undefined;
  }

  private resolveWorkspacePath(input: string): string {
    return normalizeFileTreePath(nativePathFromHost(absoluteRuntimePath(this.root, input)));
  }

  private relative(absolutePath: string): PortableRelativePath {
    return relativePathWithin(this.root, hostPathFromNative(absolutePath));
  }

  private relativeOrNull(absolutePath: string): PortableRelativePath | null {
    try {
      return this.relative(absolutePath);
    } catch {
      return null;
    }
  }

  private absolute(relativePath: PortableRelativePath): string {
    return normalizeFileTreePath(nativePathFromHost(resolveRelativePath(this.root, relativePath)));
  }
}

function folderView(snapshot: Snapshot<FolderListing | undefined>): FolderView {
  if (snapshot.status === 'error') {
    return {
      status: 'error',
      message: treeMutationErrorMessage(treeMutationError(snapshot.error)),
    };
  }
  const listing = snapshot.value;
  if (!listing) return { status: 'loading' };
  if (listing.status === 'error')
    return { status: 'error', message: fsErrorMessage(listing.error) };
  return { status: 'ready', entries: listing.entries };
}

/** The root and every folder between it and `target`, outermost first. */
function folderChain(target: PortableRelativePath): PortableRelativePath[] {
  const segments = target.split('/').filter(Boolean);
  return segments.map((_, index) => portablePath(segments.slice(0, index).join('/')));
}

function parentOf(path: PortableRelativePath): PortableRelativePath {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? ROOT_RELATIVE_PATH : portablePath(path.slice(0, slash));
}

function treeMutationError(error: unknown): TreeMutationError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Unknown procedure')) {
    return { type: 'unavailable', message: protocolUpgradeMessage('upgrade-server') };
  }
  return { type: 'unavailable', message };
}

function treeMutationErrorMessage(error: TreeMutationError): string {
  if ('message' in error && error.message) return error.message;
  if ('path' in error && error.path) return `${error.type}: ${error.path}`;
  return error.type;
}

function fsErrorMessage(error: FsError): string {
  return 'message' in error ? error.message : `${error.type}: ${error.path}`;
}

function parentPathFromPath(path: string): string | null {
  const index = path.lastIndexOf('/');
  if (index < 0) return null;
  return index === 0 ? '/' : path.slice(0, index);
}

function basenameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
