import { ok } from '@emdash/shared';
import type { LiveModelMutationCtx } from '@emdash/wire/rpc';
import type { PortableRelativePath } from '@primitives/path/api';
import type { FileEntry, FileTreeModel } from './state';

type TreeRecipeContext = LiveModelMutationCtx;

export function optimisticCreateFile(
  context: TreeRecipeContext,
  input: { path: PortableRelativePath }
) {
  context.produce('tree', (model) => reduceCreateFile(model as FileTreeModel, input));
  return ok<void>();
}

export function reduceCreateFile(
  model: FileTreeModel,
  input: { path: PortableRelativePath }
): void {
  insertEntry(model, {
    path: input.path,
    kind: 'file',
    childrenLoaded: false,
    children: [],
  });
}

export function optimisticCreateDirectory(
  context: TreeRecipeContext,
  input: { path: PortableRelativePath }
) {
  context.produce('tree', (model) => reduceCreateDirectory(model as FileTreeModel, input));
  return ok<void>();
}

export function reduceCreateDirectory(
  model: FileTreeModel,
  input: { path: PortableRelativePath }
): void {
  insertEntry(model, {
    path: input.path,
    kind: 'directory',
    childrenLoaded: false,
    children: [],
    hasChildren: false,
  });
}

export function optimisticDelete(
  context: TreeRecipeContext,
  input: { path: PortableRelativePath }
) {
  context.produce('tree', (model) => reduceDelete(model as FileTreeModel, input));
  return ok<void>();
}

export function reduceDelete(model: FileTreeModel, input: { path: PortableRelativePath }): void {
  removeSubtree(model, input.path);
}

export function optimisticRename(
  context: TreeRecipeContext,
  input: { from: PortableRelativePath; to: PortableRelativePath }
) {
  context.produce('tree', (model) => reduceRename(model as FileTreeModel, input));
  return ok<void>();
}

export function reduceRename(
  model: FileTreeModel,
  input: { from: PortableRelativePath; to: PortableRelativePath }
): void {
  relocateSubtree(model, input.from, input.to);
}

export const optimisticMove = optimisticRename;
export const reduceMove = reduceRename;

export function optimisticCopy(
  context: TreeRecipeContext,
  input: { from: PortableRelativePath; to: PortableRelativePath }
) {
  context.produce('tree', (model) => reduceCopy(model as FileTreeModel, input));
  return ok<void>();
}

export function reduceCopy(
  model: FileTreeModel,
  input: { from: PortableRelativePath; to: PortableRelativePath }
): void {
  copyEntry(model, input.from, input.to);
}

function insertEntry(
  model: FileTreeModel,
  entry: Pick<FileEntry, 'path' | 'kind' | 'childrenLoaded' | 'children'> &
    Partial<
      Omit<FileEntry, 'path' | 'name' | 'parentPath' | 'kind' | 'childrenLoaded' | 'children'>
    >
): void {
  if (!entry.path || model.entries[entry.path]) return;
  const parentPath = parentPathFor(entry.path);
  const parent = model.entries[parentPath];
  if (!parent) return;
  if (!parent.childrenLoaded) {
    parent.hasChildren = true;
    return;
  }
  const name = basename(entry.path);
  model.entries[entry.path] = {
    ...entry,
    name,
    parentPath,
  };
  if (!parent.children.includes(entry.path)) parent.children.push(entry.path);
  parent.hasChildren = parent.children.length > 0;
}

function relocateSubtree(
  model: FileTreeModel,
  from: PortableRelativePath,
  to: PortableRelativePath
): void {
  if (!from || from === to || model.entries[to] || isDescendantPath(to, from)) return;
  const source = model.entries[from];
  if (!source) return;

  removeSubtree(model, from);

  const parentPath = parentPathFor(to);
  const parent = model.entries[parentPath];
  if (!parent) return;
  if (!parent.childrenLoaded) {
    parent.hasChildren = true;
    return;
  }

  const relocated: FileEntry = {
    ...source,
    path: to,
    name: basename(to),
    parentPath,
    childrenLoaded: false,
    children: [],
    hasChildren:
      source.kind === 'directory' || source.symlinkTargetKind === 'directory'
        ? (source.hasChildren ?? source.children.length > 0)
        : undefined,
  };
  model.entries[to] = relocated;
  if (!parent.children.includes(to)) parent.children.push(to);
  parent.hasChildren = parent.children.length > 0;
}

function copyEntry(
  model: FileTreeModel,
  from: PortableRelativePath,
  to: PortableRelativePath
): void {
  if (!from || from === to || model.entries[to] || isDescendantPath(to, from)) return;
  const source = model.entries[from];
  if (!source) return;

  const parentPath = parentPathFor(to);
  const parent = model.entries[parentPath];
  if (!parent) return;
  if (!parent.childrenLoaded) {
    parent.hasChildren = true;
    return;
  }

  const copied: FileEntry = {
    ...source,
    path: to,
    name: basename(to),
    parentPath,
    childrenLoaded: false,
    children: [],
    hasChildren:
      source.kind === 'directory' || source.symlinkTargetKind === 'directory'
        ? (source.hasChildren ?? source.children.length > 0)
        : undefined,
  };
  model.entries[to] = copied;
  if (!parent.children.includes(to)) parent.children.push(to);
  parent.hasChildren = parent.children.length > 0;
}

function removeSubtree(model: FileTreeModel, path: PortableRelativePath): void {
  if (!path) return;
  const entry = model.entries[path];
  if (!entry) return;
  const parent = entry.parentPath === null ? undefined : model.entries[entry.parentPath];
  if (parent) {
    parent.children = parent.children.filter((child) => child !== path);
    parent.hasChildren = parent.children.length > 0;
  }
  const prefix = `${path}/`;
  for (const entryPath of Object.keys(model.entries)) {
    if (entryPath === path || entryPath.startsWith(prefix)) delete model.entries[entryPath];
  }
}

function parentPathFor(path: PortableRelativePath): PortableRelativePath {
  const index = path.lastIndexOf('/');
  return (index < 0 ? '' : path.slice(0, index)) as PortableRelativePath;
}

function basename(path: PortableRelativePath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function isDescendantPath(candidatePath: PortableRelativePath, ancestorPath: PortableRelativePath) {
  return candidatePath.startsWith(`${ancestorPath}/`);
}
