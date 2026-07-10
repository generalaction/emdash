// Reconciles a mutable Immer draft with a freshly computed plain value while
// preserving object/array identity where possible so live patches stay small.
export function reconcileDraft<T>(draft: T, next: T): T | void {
  if (Object.is(draft, next)) return;

  if (Array.isArray(draft) && Array.isArray(next)) {
    reconcileArray(draft as unknown[], next as unknown[]);
    return;
  }

  if (isPlainObject(draft) && isPlainObject(next)) {
    reconcileObject(draft, next);
    return;
  }

  return next;
}

function reconcileArray(draft: unknown[], next: unknown[]): void {
  draft.length = next.length;
  for (let i = 0; i < next.length; i += 1) {
    const current = draft[i];
    const incoming = next[i];
    if (Array.isArray(current) && Array.isArray(incoming)) {
      reconcileArray(current, incoming);
    } else if (isPlainObject(current) && isPlainObject(incoming)) {
      reconcileObject(current, incoming);
    } else {
      const replacement = reconcileDraft(current, incoming);
      if (replacement !== undefined || incoming === undefined) draft[i] = replacement;
    }
  }
}

function reconcileObject(draft: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const key of Object.keys(draft)) {
    if (!(key in next)) delete draft[key];
  }

  for (const [key, incoming] of Object.entries(next)) {
    const current = draft[key];
    if (Array.isArray(current) && Array.isArray(incoming)) {
      reconcileArray(current, incoming);
    } else if (isPlainObject(current) && isPlainObject(incoming)) {
      reconcileObject(current, incoming);
    } else {
      const replacement = reconcileDraft(current, incoming);
      if (replacement !== undefined || incoming === undefined) draft[key] = replacement;
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
