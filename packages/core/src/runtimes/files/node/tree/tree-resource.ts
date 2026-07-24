import path from 'node:path';
import { ok, type Result } from '@emdash/shared';
import {
  LiveState,
  type LiveCursor,
  type LiveSource,
  type ResourceMutationContext,
} from '@emdash/wire';
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
import type { RootChange, RootResource } from '@runtimes/files/node/root/root-resource';
import { TreeDirectoryReader } from './directory-reader';
import { classifyTreeChanges } from './watch-classifier';

type TreeModel = typeof filesContract.tree.model;
type TreeMutationName = Extract<keyof TreeModel['mutations'], string>;
type TreeMutationContext<Name extends TreeMutationName> = ResourceMutationContext<
  TreeModel,
  TreeResource,
  Name
>;
type ExpansionDepth = 1 | 2;

export type TreeResourceOptions = {
  identity: TreeIdentity;
  root: RootResource;
  onError?: (context: string, error: unknown) => void;
};

export class TreeResource {
  readonly identity: TreeIdentity;

  private readonly state: LiveState<FileTreeModel>;
  private readonly reader: TreeDirectoryReader;
  private readonly unsubscribeRoot: () => void;
  private readonly onError: (context: string, error: unknown) => void;
  private lane: Promise<void> = Promise.resolve();
  private resyncRun: Promise<void> | null = null;
  private trailingResyncRequested = false;
  private disposed = false;

  constructor(private readonly options: TreeResourceOptions) {
    this.identity = options.identity;
    this.reader = new TreeDirectoryReader(options.root.paths);
    this.onError = options.onError ?? (() => {});
    this.state = new LiveState(initialTree(options.identity.root.root));
    this.unsubscribeRoot = options.root.subscribe((changes) => this.onRootChanges(changes));
  }

  source(): LiveSource {
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
      await context.settle('tree', result.data);
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
        await context.settle('tree', this.state.cursor);
        return ok<void>();
      }
      removeDescendants(model, entry.path);
      entry.children = [];
      entry.childrenLoaded = false;
      entry.hasChildren = undefined;
      const cursor = this.state.replace(model, { mutationIds: [context.mutationId] });
      await context.settle('tree', cursor);
      return ok<void>();
    });
  }

  reveal(context: TreeMutationContext<'reveal'>): Promise<Result<void, FsError>> {
    return this.run(async () => {
      const validated = this.options.root.paths.resolveEntry(context.input.path);
      if (!validated.success) return validated;
      const target = validated.data.path;
      let cursor = this.state.cursor;
      for (const ancestor of ancestorPaths(target)) {
        const expanded = await this.expandPath(ancestor, context.mutationId);
        if (!expanded.success) return expanded;
        cursor = expanded.data;
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
        cursor = expanded.data;
      }
      await context.settle('tree', cursor);
      return ok<void>();
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.trailingResyncRequested = false;
    this.unsubscribeRoot();
    await this.lane;
    this.state.dispose();
  }

  private async expandPath(
    entryPath: PortableRelativePath,
    mutationId?: string,
    depth: ExpansionDepth = 1
  ): Promise<Result<LiveCursor, FsError>> {
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
      this.state.replace(model, {
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

  private onRootChanges(changes: RootChange[]): void {
    if (classifyTreeChanges(this.current(), changes).resync) {
      this.requestResync();
      return;
    }
    void this.run(() => this.reconcileChanges(changes)).catch((error: unknown) => {
      this.onError(`files tree watch ${this.identity.treeId}`, error);
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
    if (changed) this.state.replace(current);
  }

  private async resync(previous: FileTreeModel): Promise<void> {
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
    this.state.replace(next);
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
    return this.state.snapshot().data;
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
