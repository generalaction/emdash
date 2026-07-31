import path from 'node:path';
import { ok, type Result } from '@emdash/shared';
import {
  cell,
  snapshot,
  type Cell,
  type ExposedMutationContext,
  type Revision,
} from '@emdash/wire';
import { DEFAULT_TREE_EXCLUDE, ExclusionPolicy } from '@primitives/lib/api';
import {
  parsePortableRelativePath,
  ROOT_RELATIVE_PATH,
  type PortableRelativePath,
} from '@primitives/path/api';
import {
  isExpandableFileEntry,
  type FileEntry,
  type FileTreeModel,
  type FsError,
  type filesContract,
} from '@runtimes/files/api';
import type { TreeIdentity } from '@runtimes/files/node/allocation/identity';
import {
  copyInRoot,
  createDirectoryInRoot,
  createFileInRoot,
  deleteInRoot,
  moveInRoot,
  renameInRoot,
} from '@runtimes/files/node/fs/mutation-ops';
import type { RootChange, RootResource } from '@runtimes/files/node/root/root-resource';
import { TreeDirectoryReader } from './directory-reader';
import { classifyTreeChanges } from './watch-classifier';

type TreeModel = typeof filesContract.tree.model;
type TreeMutationName = Extract<keyof TreeModel['mutations'], string>;
type TreeMutationContext<Name extends TreeMutationName> = Omit<
  ExposedMutationContext<TreeModel, Name>,
  'observed'
> & {
  resource?: TreeResource;
  observed?: ExposedMutationContext<TreeModel, Name>['observed'];
  settle?(name: 'tree', revision: Revision | Promise<Revision>): Promise<void>;
};
type ExpansionDepth = 1 | 2;

export type TreeResourceOptions = {
  identity: TreeIdentity;
  root: RootResource;
  onError?: (context: string, error: unknown) => void;
};

export class TreeResource {
  readonly identity: TreeIdentity;

  private readonly state: Cell<FileTreeModel>;
  private readonly exclusions: ExclusionPolicy;
  private readonly reader: TreeDirectoryReader;
  private readonly unsubscribeRoot: () => void;
  private readonly onError: (context: string, error: unknown) => void;
  private lane: Promise<void> = Promise.resolve();
  private resyncRun: Promise<void> | null = null;
  private trailingResyncRequested = false;
  private disposed = false;

  constructor(private readonly options: TreeResourceOptions) {
    this.identity = options.identity;
    this.exclusions = new ExclusionPolicy(options.identity.exclusions ?? DEFAULT_TREE_EXCLUDE);
    this.reader = new TreeDirectoryReader(options.root.paths, this.exclusions);
    this.onError = options.onError ?? (() => {});
    this.state = cell(initialTree(options.identity.root.root));
    this.unsubscribeRoot = options.root.subscribe((changes) => this.onRootChanges(changes));
  }

  source(): Cell<FileTreeModel> {
    this.assertActive();
    return this.state;
  }

  expand(context: TreeMutationContext<'expand'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const result = await this.expandPath(
        context.input.path,
        context.mutationId,
        normalizeExpansionDepth(context.input.depth)
      );
      if (!result.success) return result;
      await observeTree(context, result.data);
      return ok<void>();
    });
  }

  collapse(context: TreeMutationContext<'collapse'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const validated = this.options.root.paths.resolveEntry(context.input.path);
      if (!validated.success) return validated;
      const model = this.current();
      const entry = model.entries[validated.data.path];
      if (!entry)
        return { success: false, error: { type: 'not-found', path: validated.data.path } };
      if (!isExpandableFileEntry(entry)) {
        return {
          success: false,
          error: { type: 'not-a-directory', path: validated.data.path },
        };
      }
      if (!entry.childrenLoaded && entry.children.length === 0) {
        await observeTree(context, this.state.set(this.current()));
        return ok<void>();
      }
      removeDescendants(model, entry.path);
      entry.children = [];
      entry.childrenLoaded = false;
      entry.hasChildren = undefined;
      const revision = this.state.set(model, { mutationIds: [context.mutationId] });
      await observeTree(context, revision);
      return ok<void>();
    });
  }

  reveal(context: TreeMutationContext<'reveal'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const validated = this.options.root.paths.resolveEntry(context.input.path);
      if (!validated.success) return validated;
      const target = validated.data.path;
      let revision = this.state.set(this.current());
      for (const ancestor of ancestorPaths(target)) {
        const expanded = await this.expandPath(ancestor, context.mutationId);
        if (!expanded.success) return expanded;
        revision = expanded.data;
      }
      const targetEntry = this.current().entries[target];
      if (!targetEntry) {
        return { success: false, error: { type: 'not-found', path: target } };
      }
      if (isExpandableFileEntry(targetEntry)) {
        const expanded = await this.expandPath(
          target,
          context.mutationId,
          normalizeExpansionDepth(context.input.depth)
        );
        if (!expanded.success) return expanded;
        revision = expanded.data;
      }
      await observeTree(context, revision);
      return ok<void>();
    });
  }

  createFile(context: TreeMutationContext<'createFile'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const changes = await createFileInRoot(this.options.root, context.input);
      if (!changes.success) return changes;
      this.options.root.publishKnownChanges(changes.data);
      const reconciled = await this.reconcileMutationParents(changedParents(changes.data), context);
      if (!reconciled.success) return reconciled;
      await observeTree(context, reconciled.data);
      return ok<void>();
    });
  }

  createDirectory(context: TreeMutationContext<'createDirectory'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const changes = await createDirectoryInRoot(this.options.root, context.input);
      if (!changes.success) return changes;
      this.options.root.publishKnownChanges(changes.data);
      const reconciled = await this.reconcileMutationParents(changedParents(changes.data), context);
      if (!reconciled.success) return reconciled;
      await observeTree(context, reconciled.data);
      return ok<void>();
    });
  }

  delete(context: TreeMutationContext<'delete'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const changes = await deleteInRoot(this.options.root, context.input);
      if (!changes.success) return changes;
      this.options.root.publishKnownChanges(changes.data);
      const reconciled = await this.reconcileMutationParents(changedParents(changes.data), context);
      if (!reconciled.success) return reconciled;
      await observeTree(context, reconciled.data);
      return ok<void>();
    });
  }

  rename(context: TreeMutationContext<'rename'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const changes = await renameInRoot(this.options.root, context.input);
      if (!changes.success) return changes;
      this.options.root.publishKnownChanges(changes.data);
      const reconciled = await this.reconcileMutationParents(changedParents(changes.data), context);
      if (!reconciled.success) return reconciled;
      await observeTree(context, reconciled.data);
      return ok<void>();
    });
  }

  move(context: TreeMutationContext<'move'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const changes = await moveInRoot(this.options.root, context.input);
      if (!changes.success) return changes;
      this.options.root.publishKnownChanges(changes.data);
      const reconciled = await this.reconcileMutationParents(changedParents(changes.data), context);
      if (!reconciled.success) return reconciled;
      await observeTree(context, reconciled.data);
      return ok<void>();
    });
  }

  copy(context: TreeMutationContext<'copy'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const changes = await copyInRoot(this.options.root, context.input);
      if (!changes.success) return changes;
      this.options.root.publishKnownChanges(changes.data);
      const reconciled = await this.reconcileMutationParents(changedParents(changes.data), context);
      if (!reconciled.success) return reconciled;
      await observeTree(context, reconciled.data);
      return ok<void>();
    });
  }

  refresh(context: TreeMutationContext<'refresh'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const revision = await this.resync(this.current(), [context.mutationId]);
      await observeTree(context, revision);
      return ok<void>();
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.trailingResyncRequested = false;
    this.unsubscribeRoot();
    await this.lane;
  }

  private async expandPath(
    entryPath: PortableRelativePath,
    mutationId?: string,
    depth: ExpansionDepth = 1
  ): Promise<Result<Revision, FsError>> {
    const validated = this.options.root.paths.resolveEntry(entryPath);
    if (!validated.success) return validated;
    const model = this.current();
    const entry = model.entries[validated.data.path];
    if (!entry) return { success: false, error: { type: 'not-found', path: validated.data.path } };
    if (!isExpandableFileEntry(entry)) {
      return {
        success: false,
        error: { type: 'not-a-directory', path: validated.data.path },
      };
    }

    const children = await this.reader.readChildren(entry.path);
    if (!children.success) return children;
    reconcileDirectory(model, entry.path, children.data);
    if (depth > 1) {
      await this.expandLoadedChildren(model, entry.path);
    }
    return ok(
      this.state.set(model, {
        mutationIds: mutationId === undefined ? undefined : [mutationId],
      })
    );
  }

  private async expandLoadedChildren(
    model: FileTreeModel,
    entryPath: PortableRelativePath
  ): Promise<void> {
    const entry = model.entries[entryPath];
    if (!entry) return;
    for (const childPath of entry.children) {
      const child = model.entries[childPath];
      if (!child || !isExpandableFileEntry(child)) continue;
      const children = await this.reader.readChildren(child.path);
      if (!children.success) {
        this.onError(`files tree eager expand ${child.path}`, children.error);
        continue;
      }
      reconcileDirectory(model, child.path, children.data);
    }
  }

  private async reconcileMutationParents(
    parents: PortableRelativePath[],
    context: TreeMutationContext<TreeMutationName>
  ): Promise<Result<Revision, FsError>> {
    const model = this.current();
    let changed = false;
    for (const parentPath of parents) {
      const parent = model.entries[parentPath];
      if (!parent || !isExpandableFileEntry(parent)) continue;
      const children = await this.reader.readChildren(parentPath);
      if (!children.success) return children;
      reconcileDirectory(model, parentPath, children.data);
      changed = true;
    }
    return ok(
      this.state.set(changed ? model : this.current(), {
        mutationIds: [context.mutationId],
      })
    );
  }

  private onRootChanges(changes: RootChange[]): void {
    const relevantChanges = this.filterExcludedChanges(changes);
    if (relevantChanges.length === 0) return;
    if (classifyTreeChanges(this.current(), relevantChanges).resync) {
      this.requestResync();
      return;
    }
    void this.run(() => this.reconcileChanges(relevantChanges)).catch((error: unknown) => {
      this.onError(`files tree watch ${this.identity.treeId}`, error);
    });
  }

  private filterExcludedChanges(changes: RootChange[]): RootChange[] {
    return changes.filter((change) => {
      if (change.kind === 'resync') return true;
      return !this.exclusions.excludes(change.path);
    });
  }

  private async reconcileChanges(changes: RootChange[]): Promise<void> {
    const current = this.current();
    const effects = classifyTreeChanges(current, changes);
    if (effects.resync) {
      await this.resync(current);
      return;
    }

    let changed = false;
    for (const parent of effects.loadedParents) {
      if (!current.entries[parent]?.childrenLoaded) continue;
      const children = await this.reader.readChildren(parent);
      if (!children.success) {
        this.onError(`files tree refresh ${parent}`, children.error);
        continue;
      }
      reconcileDirectory(current, parent, children.data);
      changed = true;
    }
    if (changed) this.state.set(current);
  }

  private async resync(
    previous: FileTreeModel,
    mutationIds?: readonly string[]
  ): Promise<Revision> {
    const loaded = Object.values(previous.entries)
      .filter((entry) => entry.childrenLoaded)
      .map((entry) => entry.path)
      .sort((left, right) => depth(left) - depth(right));
    const next = initialTree(this.identity.root.root);
    for (const entryPath of loaded) {
      const entry = next.entries[entryPath];
      if (!entry || !isExpandableFileEntry(entry)) continue;
      const children = await this.reader.readChildren(entryPath);
      if (!children.success) {
        this.onError(`files tree resync ${entryPath}`, children.error);
        continue;
      }
      reconcileDirectory(next, entryPath, children.data);
    }
    return this.state.set(next, {
      mutationIds: mutationIds ? [...mutationIds] : undefined,
    });
  }

  private requestResync(): void {
    if (this.disposed) return;
    if (this.resyncRun) {
      this.trailingResyncRequested = true;
      return;
    }

    const run = this.run(() => this.drainResyncs());
    this.resyncRun = run;
    void run.then(
      () => this.finishResyncRun(run),
      (error: unknown) => {
        this.onError(`files tree resync ${this.identity.treeId}`, error);
        this.finishResyncRun(run);
      }
    );
  }

  private async drainResyncs(): Promise<void> {
    do {
      this.trailingResyncRequested = false;
      await this.resync(this.current());
    } while (this.trailingResyncRequested && !this.disposed);
  }

  private finishResyncRun(run: Promise<void>): void {
    if (this.resyncRun !== run) return;
    this.resyncRun = null;
    if (!this.trailingResyncRequested || this.disposed) return;
    this.trailingResyncRequested = false;
    this.requestResync();
  }

  private current(): FileTreeModel {
    return structuredClone(snapshot(this.state).value);
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    this.assertActive();
    const result = this.lane.then(work, work);
    this.lane = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('TreeResource is disposed');
  }
}

function initialTree(root: FileTreeModel['root']): FileTreeModel {
  const rootPath = root.segments.at(-1) ?? '';
  const name = path.basename(rootPath) || rootPath;
  return {
    root,
    entries: {
      '': {
        path: ROOT_RELATIVE_PATH,
        name,
        parentPath: null,
        kind: 'directory',
        childrenLoaded: false,
        children: [],
      },
    },
  };
}

function normalizeExpansionDepth(depth: number | undefined): ExpansionDepth {
  return depth === 2 ? 2 : 1;
}

function ancestorPaths(target: PortableRelativePath): PortableRelativePath[] {
  const segments = target === '' ? [] : target.split('/');
  const ancestors: PortableRelativePath[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (index === 0) {
      ancestors.push(ROOT_RELATIVE_PATH);
      continue;
    }
    const ancestor = parsePortableRelativePath(segments.slice(0, index).join('/'));
    if (ancestor.success) ancestors.push(ancestor.data);
  }
  return ancestors;
}

function changedParents(changes: RootChange[]): PortableRelativePath[] {
  const parents = new Set<PortableRelativePath>();
  for (const change of changes) {
    if (change.kind === 'resync') continue;
    parents.add(parentPath(change.path));
  }
  return [...parents];
}

function parentPath(entryPath: PortableRelativePath): PortableRelativePath {
  const index = entryPath.lastIndexOf('/');
  return (index < 0 ? '' : entryPath.slice(0, index)) as PortableRelativePath;
}

function reconcileDirectory(
  model: FileTreeModel,
  parentPath: PortableRelativePath,
  incoming: FileEntry[]
): void {
  const parent = model.entries[parentPath];
  if (!parent) return;
  const incomingPaths = new Set(incoming.map((entry) => entry.path));
  for (const previousPath of parent.children) {
    if (!incomingPaths.has(previousPath)) removeSubtree(model, previousPath);
  }

  for (const entry of incoming) {
    const previous = model.entries[entry.path];
    if (previous && isExpandableFileEntry(previous) && isExpandableFileEntry(entry)) {
      entry.childrenLoaded = previous.childrenLoaded;
      entry.children = previous.children;
      entry.hasChildren = previous.hasChildren;
    } else if (previous) {
      removeDescendants(model, previous.path);
    }
    model.entries[entry.path] = entry;
  }
  parent.children = incoming.map((entry) => entry.path);
  parent.childrenLoaded = true;
  parent.hasChildren = incoming.length > 0;
}

function removeDescendants(model: FileTreeModel, parentPath: PortableRelativePath): void {
  const prefix = parentPath === '' ? '' : `${parentPath}/`;
  for (const entryPath of Object.keys(model.entries)) {
    if (entryPath !== parentPath && (prefix === '' || entryPath.startsWith(prefix))) {
      delete model.entries[entryPath];
    }
  }
}

function removeSubtree(model: FileTreeModel, entryPath: PortableRelativePath): void {
  removeDescendants(model, entryPath);
  delete model.entries[entryPath];
}

function depth(entryPath: PortableRelativePath): number {
  return entryPath === '' ? 0 : entryPath.split('/').length;
}

function observeTree<Name extends TreeMutationName>(
  context: TreeMutationContext<Name>,
  revision: Revision | Promise<Revision>
): Promise<void> {
  if (context.observed) return context.observed('tree', revision);
  return context.settle?.('tree', revision) ?? Promise.resolve();
}
