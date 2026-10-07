import { describe, expect, it } from 'vitest';
import { produceWithPatches, type Patch } from '../../live/state/immer-setup';
import { assignDraft } from './assign-draft';

/** The pre-optimization algorithm: always descends through the draft. */
function referenceAssign<T>(draft: T, next: T): T | void {
  if (!isObjectLike(draft) || !isObjectLike(next)) return structuredClone(next);
  if (Array.isArray(draft) || Array.isArray(next)) {
    if (!Array.isArray(draft) || !Array.isArray(next)) return structuredClone(next);
    draft.length = next.length;
    for (let index = 0; index < next.length; index += 1) {
      const replacement = referenceValue(draft[index], next[index]);
      if (replacement !== undefined) draft[index] = replacement;
    }
    return;
  }
  const draftRecord = draft as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  for (const key of Object.keys(draftRecord)) {
    if (!(key in nextRecord)) delete draftRecord[key];
  }
  for (const [key, incoming] of Object.entries(nextRecord)) {
    const replacement = referenceValue(draftRecord[key], incoming);
    if (replacement !== undefined) draftRecord[key] = replacement;
  }
}

function referenceValue(current: unknown, incoming: unknown): unknown | undefined {
  if (Object.is(current, incoming)) return undefined;
  if (isObjectLike(current) && isObjectLike(incoming)) {
    const replacement = referenceAssign(current, incoming);
    return replacement === undefined ? undefined : replacement;
  }
  return incoming;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function patchesFor<T extends object>(
  base: T,
  next: T,
  assign: (draft: T, next: T) => T | void
): { value: T; patches: Patch[] } {
  const [value, patches] = produceWithPatches(base, (draft) => assign(draft as T, next) as never);
  return { value: value as T, patches };
}

type Entry = { name: string; size: number; children: string[]; meta?: { tag: string } };
type Model = { root: string; entries: Record<string, Entry> };

function model(): Model {
  return {
    root: '/repo',
    entries: {
      a: { name: 'a', size: 1, children: [] },
      b: { name: 'b', size: 2, children: ['b/x', 'b/y'], meta: { tag: 'one' } },
      c: { name: 'c', size: 3, children: [] },
    },
  };
}

describe('assignDraft', () => {
  const cases: Array<[string, (next: Model) => void]> = [
    ['no change', () => {}],
    ['a primitive field', (next) => (next.entries.a = { ...next.entries.a, size: 10 })],
    ['an added entry', (next) => (next.entries.d = { name: 'd', size: 4, children: [] })],
    ['a removed entry', (next) => delete next.entries.c],
    [
      'a grown array',
      (next) => (next.entries.b = { ...next.entries.b, children: ['b/x', 'b/y', 'b/z'] }),
    ],
    ['a shrunk array', (next) => (next.entries.b = { ...next.entries.b, children: ['b/y'] })],
    ['a nested object', (next) => (next.entries.b = { ...next.entries.b, meta: { tag: 'two' } })],
    [
      'a dropped optional field',
      (next) => {
        const { meta: _meta, ...rest } = next.entries.b;
        next.entries.b = rest;
      },
    ],
    ['a top-level field', (next) => (next.root = '/other')],
  ];

  it.each(cases)('produces the same patches as a full descent for %s', (_name, change) => {
    const base = model();
    const next = { ...base, entries: { ...base.entries } };
    change(next);
    const optimized = patchesFor(base, next, assignDraft);
    const reference = patchesFor(base, next, referenceAssign);
    expect(optimized.patches).toEqual(reference.patches);
    expect(optimized.value).toEqual(next);
  });

  it('produces no patches for rebuilt but structurally identical members', () => {
    const base = model();
    const rebuilt: Model = structuredClone(base);
    const { value, patches } = patchesFor(base, rebuilt, assignDraft);
    expect(patches).toEqual([]);
    expect(value).toBe(base);
  });

  it('keeps unchanged members by identity when a sibling changes', () => {
    const base = model();
    const next = { ...base, entries: { ...base.entries, a: { ...base.entries.a, size: 5 } } };
    const { value } = patchesFor(base, next, assignDraft);
    expect(value.entries.b).toBe(base.entries.b);
    expect(value.entries.c).toBe(base.entries.c);
    expect(value.entries.a).toEqual({ name: 'a', size: 5, children: [] });
  });

  it('assigns into plain objects outside an Immer draft', () => {
    const target = { a: 1, b: { c: 2 } };
    assignDraft(target, { a: 1, b: { c: 3 } });
    expect(target).toEqual({ a: 1, b: { c: 3 } });
  });
});
