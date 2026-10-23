import { isDraft, original } from 'immer';

/**
 * How deep `isUnchanged` looks for structural equality before falling back to
 * descending into the draft. Two levels cover a keyed record of small objects
 * whose array fields were rebuilt with the same members.
 */
const UNCHANGED_PROBE_DEPTH = 2;

/**
 * Assigns `next` into an Immer draft so the produced patches describe only the
 * differences. Members are compared against the draft's original state before
 * touching the draft: identical or structurally identical members are skipped
 * without creating child drafts, which keeps publishing a large keyed record
 * proportional to its changed members. The produced patches are the same as a
 * full descent would produce.
 */
export function assignDraft<T>(draft: T, next: T): T | void {
  if (!isObjectLike(draft) || !isObjectLike(next)) return structuredClone(next);
  const base = originalOf(draft);
  if (Array.isArray(draft) || Array.isArray(next)) {
    if (!Array.isArray(draft) || !Array.isArray(next)) return structuredClone(next);
    const baseArray = base as unknown[];
    if (draft.length !== next.length) draft.length = next.length;
    for (let index = 0; index < next.length; index += 1) {
      if (index < baseArray.length && isUnchanged(baseArray[index], next[index])) continue;
      const replacement = assignDraftValue(draft[index], next[index]);
      if (replacement !== undefined) draft[index] = replacement;
    }
    return;
  }

  const draftRecord = draft as Record<string, unknown>;
  const baseRecord = base as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  for (const key of Object.keys(baseRecord)) {
    if (!Object.hasOwn(nextRecord, key)) delete draftRecord[key];
  }
  for (const key of Object.keys(nextRecord)) {
    const incoming = nextRecord[key];
    if (Object.hasOwn(baseRecord, key) && isUnchanged(baseRecord[key], incoming)) continue;
    const replacement = assignDraftValue(draftRecord[key], incoming);
    if (replacement !== undefined) draftRecord[key] = replacement;
  }
}

function assignDraftValue(current: unknown, incoming: unknown): unknown | undefined {
  if (Object.is(current, incoming)) return undefined;
  if (isObjectLike(current) && isObjectLike(incoming)) {
    const replacement = assignDraft(current, incoming);
    return replacement === undefined ? undefined : replacement;
  }
  return incoming;
}

function originalOf(value: object): object {
  return isDraft(value) ? (original(value) as object) : value;
}

/** True only when assigning `incoming` over `current` could not change the draft. */
function isUnchanged(current: unknown, incoming: unknown, depth = UNCHANGED_PROBE_DEPTH): boolean {
  if (Object.is(current, incoming)) return true;
  if (depth === 0 || !isObjectLike(current) || !isObjectLike(incoming)) return false;
  if (Array.isArray(current) || Array.isArray(incoming)) {
    if (!Array.isArray(current) || !Array.isArray(incoming)) return false;
    if (current.length !== incoming.length) return false;
    for (let index = 0; index < current.length; index += 1) {
      if (!isUnchanged(current[index], incoming[index], depth - 1)) return false;
    }
    return true;
  }
  const currentKeys = Object.keys(current);
  if (currentKeys.length !== Object.keys(incoming).length) return false;
  for (const key of currentKeys) {
    if (!Object.hasOwn(incoming, key)) return false;
    if (!isUnchanged(current[key], incoming[key], depth - 1)) return false;
  }
  return true;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
