/**
 * Deep-reconciles an Immer draft toward a target value, writing only where
 * values actually differ so Immer records minimal patches.
 */
export function reconcileDraft<T>(draft: T, next: T): T | void {
  if (!isObjectLike(draft) || !isObjectLike(next)) {
    return structuredClone(next);
  }

  if (Array.isArray(draft) || Array.isArray(next)) {
    if (!Array.isArray(draft) || !Array.isArray(next)) {
      return structuredClone(next);
    }
    draft.length = next.length;
    for (let index = 0; index < next.length; index += 1) {
      const current = draft[index];
      const incoming = next[index];
      if (Object.is(current, incoming)) continue;
      if (isObjectLike(current) && isObjectLike(incoming)) {
        const replacement = reconcileDraft(current, incoming);
        if (replacement !== undefined) draft[index] = replacement;
      } else {
        draft[index] = incoming;
      }
    }
    return;
  }

  const draftRecord = draft as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  for (const key of Object.keys(draftRecord)) {
    if (!(key in nextRecord)) {
      delete draftRecord[key];
    }
  }
  for (const [key, incoming] of Object.entries(nextRecord)) {
    const current = draftRecord[key];
    if (Object.is(current, incoming)) continue;
    if (isObjectLike(current) && isObjectLike(incoming)) {
      const replacement = reconcileDraft(current, incoming);
      if (replacement !== undefined) draftRecord[key] = replacement;
    } else {
      draftRecord[key] = incoming;
    }
  }
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
