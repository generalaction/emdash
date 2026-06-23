import path from 'node:path';
import { err, ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import type { RawFileEvent } from '../../fs';
import type { DevIno, ListedEntry } from '../list';
import type { FileNodeType, NodeId } from '../models/tree';
import { NodeIdAssigner } from '../node-id';
import { classifyFileTreeWatchEvents, type FileTreeStatEntry } from './classifier';

const rootPath = path.resolve('repo');

describe('classifyFileTreeWatchEvents', () => {
  it('ignores content update events', async () => {
    const ids = new NodeIdAssigner();
    ids.upsert(entry('a.txt', 'file', '1:1'), null);

    const classification = await classify(ids, [{ kind: 'update', path: absPath('a.txt') }]);

    expect(classification.ops).toEqual([]);
    expect(classification.unloadedScopes).toEqual([]);
  });

  it('emits a put for a create event in a loaded scope', async () => {
    const ids = new NodeIdAssigner();

    const classification = await classify(ids, [{ kind: 'create', path: absPath('a.txt') }], {
      stats: [entry('a.txt', 'file', '1:1')],
    });

    expect(classification.ops).toMatchObject([
      { op: 'put', key: expect.any(Number), value: { path: 'a.txt', parentId: null } },
    ]);
    expect(ids.getByPath('a.txt')?.id).toBe(classification.ops[0]?.key);
  });

  it('ignores creates under unloaded directory scopes', async () => {
    const ids = new NodeIdAssigner();
    ids.upsert(entry('src', 'directory', '1:1'), null);

    const classification = await classify(ids, [{ kind: 'create', path: absPath('src/a.ts') }], {
      stats: [entry('src/a.ts', 'file', '1:2')],
    });

    expect(classification.ops).toEqual([]);
    expect(ids.getByPath('src/a.ts')).toBeUndefined();
  });

  it('ignores runtime creates for excluded paths before statting them', async () => {
    const ids = new NodeIdAssigner();
    let statCalls = 0;

    const classification = await classifyFileTreeWatchEvents(
      [
        { kind: 'create', path: absPath('node_modules') },
        { kind: 'create', path: absPath('node_modules/pkg/index.js') },
        { kind: 'create', path: absPath('.DS_Store') },
      ],
      {
        rootPath,
        ids,
        isScopeLoaded: () => true,
        statEntry: async () => {
          statCalls += 1;
          return err({ type: 'fs-error', path: '', message: 'stat should not be called' });
        },
      }
    );

    expect(classification.ops).toEqual([]);
    expect(classification.unloadedScopes).toEqual([]);
    expect(statCalls).toBe(0);
    expect(ids.getByPath('node_modules')).toBeUndefined();
    expect(ids.getByPath('.DS_Store')).toBeUndefined();
  });

  it('cascades deletes for unmatched directory tombstones', async () => {
    const ids = new NodeIdAssigner();
    const src = ids.upsert(entry('src', 'directory', '1:1'), null, true);
    const nested = ids.upsert(entry('src/nested', 'directory', '1:2'), src.id, true);
    const file = ids.upsert(entry('src/nested/a.ts', 'file', '1:3'), nested.id);

    const classification = await classify(ids, [{ kind: 'delete', path: absPath('src') }], {
      loadedScopes: new Set([null, src.id, nested.id]),
    });

    expect(classification.ops).toEqual([
      { op: 'del', key: file.id },
      { op: 'del', key: nested.id },
      { op: 'del', key: src.id },
    ]);
    expect(new Set(classification.unloadedScopes)).toEqual(new Set([src.id, nested.id]));
    expect(ids.getByPath('src')).toBeUndefined();
    expect(ids.getByPath('src/nested/a.ts')).toBeUndefined();
  });

  it('reuses a file node id for a delete/create rename batch with matching inode', async () => {
    const ids = new NodeIdAssigner();
    const before = ids.upsert(entry('a.txt', 'file', '1:1'), null);

    const classification = await classify(
      ids,
      [
        { kind: 'delete', path: absPath('a.txt') },
        { kind: 'create', path: absPath('b.txt') },
      ],
      {
        stats: [entry('b.txt', 'file', '1:1')],
      }
    );

    expect(classification.ops).toEqual([
      {
        op: 'put',
        key: before.id,
        value: expect.objectContaining({ id: before.id, path: 'b.txt' }),
      },
    ]);
    expect(classification.unloadedScopes).toEqual([]);
    expect(ids.getByPath('a.txt')).toBeUndefined();
    expect(ids.getByPath('b.txt')?.id).toBe(before.id);
  });

  it('moves loaded descendants when a directory rename reuses the directory id', async () => {
    const ids = new NodeIdAssigner();
    const src = ids.upsert(entry('src', 'directory', '1:1'), null, true);
    const nested = ids.upsert(entry('src/nested', 'directory', '1:2'), src.id, true);
    const file = ids.upsert(entry('src/nested/a.ts', 'file', '1:3'), nested.id);

    const classification = await classify(
      ids,
      [
        { kind: 'delete', path: absPath('src') },
        { kind: 'create', path: absPath('lib') },
      ],
      {
        loadedScopes: new Set([null, src.id, nested.id]),
        stats: [entry('lib', 'directory', '1:1')],
      }
    );

    expect(classification.ops).toEqual([
      { op: 'put', key: src.id, value: expect.objectContaining({ id: src.id, path: 'lib' }) },
      {
        op: 'put',
        key: nested.id,
        value: expect.objectContaining({ id: nested.id, path: 'lib/nested' }),
      },
      {
        op: 'put',
        key: file.id,
        value: expect.objectContaining({ id: file.id, path: 'lib/nested/a.ts' }),
      },
    ]);
    expect(classification.unloadedScopes).toEqual([]);
    expect(ids.getByPath('src')).toBeUndefined();
    expect(ids.getByPath('lib')?.id).toBe(src.id);
    expect(ids.getByPath('lib/nested')?.id).toBe(nested.id);
    expect(ids.getByPath('lib/nested/a.ts')?.id).toBe(file.id);
  });

  it('ignores events outside the watched root', async () => {
    const ids = new NodeIdAssigner();

    const classification = await classify(ids, [
      { kind: 'create', path: path.resolve('outside/a.txt') },
    ]);

    expect(classification.ops).toEqual([]);
  });
});

async function classify(
  ids: NodeIdAssigner,
  events: RawFileEvent[],
  options: {
    loadedScopes?: Set<NodeId | null>;
    stats?: ListedEntry[];
  } = {}
) {
  const loadedScopes = options.loadedScopes ?? new Set<NodeId | null>([null]);
  return classifyFileTreeWatchEvents(events, {
    rootPath,
    ids,
    isScopeLoaded: (scope) => loadedScopes.has(scope),
    statEntry: statEntryFrom(options.stats ?? []),
  });
}

function statEntryFrom(entries: ListedEntry[]): FileTreeStatEntry {
  const byPath = new Map(entries.map((listed) => [listed.path, listed]));
  return async (_root, relPath) => {
    const listed = byPath.get(relPath);
    return listed ? ok(listed) : err({ type: 'not-found', path: relPath });
  };
}

function entry(path: string, type: FileNodeType, devIno?: DevIno): ListedEntry {
  return { path, name: basename(path), type, devIno };
}

function absPath(relPath: string): string {
  return path.join(rootPath, ...relPath.split('/'));
}

function basename(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? relPath : relPath.slice(index + 1);
}
