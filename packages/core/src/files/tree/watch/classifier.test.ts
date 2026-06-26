import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import type { WatchEvent } from '../../../watch';
import { statEntry, type DevIno, type ListedEntry } from '../list';
import type { FileNodeType, NodeId } from '../models/tree';
import { NodeIdAssigner } from '../node-id';
import { classifyFileTreeWatchEvents } from './classifier';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('classifyFileTreeWatchEvents', () => {
  it('ignores content update events', async () => {
    const root = await makeRoot();
    const ids = new NodeIdAssigner();
    ids.upsert(entry(root, 'a.txt', 'file', '1:1'), null);

    const classification = await classify(root, ids, [
      { kind: 'update', path: absPath(root, 'a.txt') },
    ]);

    expect(classification.ops).toEqual([]);
    expect(classification.unloadedScopes).toEqual([]);
  });

  it('emits a put for a create event in a loaded scope', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf8');
    const ids = new NodeIdAssigner();

    const classification = await classify(root, ids, [
      { kind: 'create', path: absPath(root, 'a.txt') },
    ]);

    expect(classification.ops).toMatchObject([
      {
        op: 'put',
        key: expect.any(Number),
        value: { path: absPath(root, 'a.txt'), parentId: null },
      },
    ]);
    expect(ids.getByPath(absPath(root, 'a.txt'))?.id).toBe(classification.ops[0]?.key);
  });

  it('ignores creates under unloaded directory scopes', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), 'a', 'utf8');
    const ids = new NodeIdAssigner();
    ids.upsert(unwrap(await statEntry(root, absPath(root, 'src'))), null);

    const classification = await classify(root, ids, [
      { kind: 'create', path: absPath(root, 'src/a.ts') },
    ]);

    expect(classification.ops).toEqual([]);
    expect(ids.getByPath(absPath(root, 'src/a.ts'))).toBeUndefined();
  });

  it('ignores runtime creates for excluded paths before statting them', async () => {
    const root = await makeRoot();
    const ids = new NodeIdAssigner();

    const classification = await classify(
      root,
      ids,
      [
        { kind: 'create', path: absPath(root, 'node_modules') },
        { kind: 'create', path: absPath(root, 'node_modules/pkg/index.js') },
        { kind: 'create', path: absPath(root, '.DS_Store') },
      ],
      { isScopeLoaded: () => true }
    );

    expect(classification.ops).toEqual([]);
    expect(classification.unloadedScopes).toEqual([]);
    expect(ids.getByPath(absPath(root, 'node_modules'))).toBeUndefined();
    expect(ids.getByPath(absPath(root, '.DS_Store'))).toBeUndefined();
  });

  it('cascades deletes for unmatched directory tombstones', async () => {
    const root = await makeRoot();
    const ids = new NodeIdAssigner();
    const src = ids.upsert(entry(root, 'src', 'directory', '1:1'), null, true);
    const nested = ids.upsert(entry(root, 'src/nested', 'directory', '1:2'), src.id, true);
    const file = ids.upsert(entry(root, 'src/nested/a.ts', 'file', '1:3'), nested.id);

    const classification = await classify(
      root,
      ids,
      [{ kind: 'delete', path: absPath(root, 'src') }],
      {
        loadedScopes: new Set([null, src.id, nested.id]),
      }
    );

    expect(classification.ops).toEqual([
      { op: 'del', key: file.id },
      { op: 'del', key: nested.id },
      { op: 'del', key: src.id },
    ]);
    expect(new Set(classification.unloadedScopes)).toEqual(new Set([src.id, nested.id]));
    expect(ids.getByPath(absPath(root, 'src'))).toBeUndefined();
    expect(ids.getByPath(absPath(root, 'src/nested/a.ts'))).toBeUndefined();
  });

  it('reuses a file node id for a delete/create rename batch with matching inode', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf8');
    const ids = new NodeIdAssigner();
    const before = ids.upsert(unwrap(await statEntry(root, absPath(root, 'a.txt'))), null);

    await rename(path.join(root, 'a.txt'), path.join(root, 'b.txt'));
    const classification = await classify(root, ids, [
      { kind: 'delete', path: absPath(root, 'a.txt') },
      { kind: 'create', path: absPath(root, 'b.txt') },
    ]);

    expect(classification.ops).toEqual([
      {
        op: 'put',
        key: before.id,
        value: expect.objectContaining({ id: before.id, path: absPath(root, 'b.txt') }),
      },
    ]);
    expect(classification.unloadedScopes).toEqual([]);
    expect(ids.getByPath(absPath(root, 'a.txt'))).toBeUndefined();
    expect(ids.getByPath(absPath(root, 'b.txt'))?.id).toBe(before.id);
  });

  it('moves loaded descendants when a directory rename reuses the directory id', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'a.ts'), 'a', 'utf8');
    const ids = new NodeIdAssigner();
    const src = ids.upsert(unwrap(await statEntry(root, absPath(root, 'src'))), null, true);
    const nested = ids.upsert(
      unwrap(await statEntry(root, absPath(root, 'src/nested'))),
      src.id,
      true
    );
    const file = ids.upsert(
      unwrap(await statEntry(root, absPath(root, 'src/nested/a.ts'))),
      nested.id
    );

    await rename(path.join(root, 'src'), path.join(root, 'lib'));
    const classification = await classify(
      root,
      ids,
      [
        { kind: 'delete', path: absPath(root, 'src') },
        { kind: 'create', path: absPath(root, 'lib') },
      ],
      {
        loadedScopes: new Set([null, src.id, nested.id]),
      }
    );

    expect(classification.ops).toEqual([
      {
        op: 'put',
        key: src.id,
        value: expect.objectContaining({ id: src.id, path: absPath(root, 'lib') }),
      },
      {
        op: 'put',
        key: nested.id,
        value: expect.objectContaining({ id: nested.id, path: absPath(root, 'lib/nested') }),
      },
      {
        op: 'put',
        key: file.id,
        value: expect.objectContaining({ id: file.id, path: absPath(root, 'lib/nested/a.ts') }),
      },
    ]);
    expect(classification.unloadedScopes).toEqual([]);
    expect(ids.getByPath(absPath(root, 'src'))).toBeUndefined();
    expect(ids.getByPath(absPath(root, 'lib'))?.id).toBe(src.id);
    expect(ids.getByPath(absPath(root, 'lib/nested'))?.id).toBe(nested.id);
    expect(ids.getByPath(absPath(root, 'lib/nested/a.ts'))?.id).toBe(file.id);
  });

  it('ignores events outside the watched root', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const ids = new NodeIdAssigner();

    const classification = await classify(root, ids, [
      { kind: 'create', path: path.join(outside, 'a.txt') },
    ]);

    expect(classification.ops).toEqual([]);
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-file-tree-classifier-'));
  roots.push(root);
  return root;
}

async function classify(
  rootPath: string,
  ids: NodeIdAssigner,
  events: WatchEvent[],
  options: {
    loadedScopes?: Set<NodeId | null>;
    isScopeLoaded?: (scope: NodeId | null) => boolean;
  } = {}
) {
  const loadedScopes = options.loadedScopes ?? new Set<NodeId | null>([null]);
  return classifyFileTreeWatchEvents(events, {
    rootPath,
    ids,
    isScopeLoaded: options.isScopeLoaded ?? ((scope) => loadedScopes.has(scope)),
  });
}

function entry(
  rootPath: string,
  relPath: string,
  type: FileNodeType,
  devIno?: DevIno
): ListedEntry {
  const path = absPath(rootPath, relPath);
  return { path, name: basename(path), type, devIno };
}

function absPath(rootPath: string, relPath: string): string {
  return path.join(rootPath, ...relPath.split('/'));
}

function basename(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? relPath : relPath.slice(index + 1);
}

function unwrap<T, E>(result: { success: true; data: T } | { success: false; error: E }): T {
  if (!result.success) throw new Error(`Expected ok result: ${JSON.stringify(result.error)}`);
  return result.data;
}
