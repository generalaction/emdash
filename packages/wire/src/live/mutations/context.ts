import type { Mutator } from '../model';
import type { LiveCursor, LiveCursorEntry } from '../protocol';
import type { LiveModelData, LiveModelKey, LiveModelRef } from './model-ref';
import { stableStringify, type LiveModelRegistry } from './registry';

export class MutationContext {
  private readonly captured = new Map<string, LiveCursorEntry>();

  constructor(
    private readonly registry: LiveModelRegistry,
    readonly mutationId: string
  ) {}

  produce<Ref extends LiveModelRef>(
    ref: Ref,
    key: LiveModelKey<Ref>,
    mutator: Mutator<LiveModelData<Ref>>
  ): void {
    const server = this.registry.resolve(ref, key);
    if (!server) return;
    const cursor = server.produce(mutator, { mutationIds: [this.mutationId] });
    this.capture(ref, key, cursor);
  }

  produceAll<Ref extends LiveModelRef>(
    ref: Ref,
    partialKey: Partial<LiveModelKey<Ref>>,
    mutator: Mutator<LiveModelData<Ref>>
  ): void {
    for (const [key, server] of this.registry.instances(ref, partialKey)) {
      const cursor = server.produce(mutator, { mutationIds: [this.mutationId] });
      this.capture(ref, key, cursor);
    }
  }

  cursors(): LiveCursorEntry[] {
    return [...this.captured.values()];
  }

  private capture<Ref extends LiveModelRef>(
    ref: Ref,
    key: LiveModelKey<Ref>,
    cursor: LiveCursor
  ): void {
    const captureKey = `${ref.id}:${stableStringify(key)}`;
    const current = this.captured.get(captureKey);
    if (current && compareCursor(current.cursor, cursor) >= 0) return;
    this.captured.set(captureKey, {
      model: ref.id,
      key,
      cursor,
    });
  }
}

function compareCursor(left: LiveCursor, right: LiveCursor): number {
  if (left.generation !== right.generation) return left.generation - right.generation;
  return left.sequence - right.sequence;
}
