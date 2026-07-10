import type { Result } from '@emdash/shared';
import type { LiveCursorEntry } from '../protocol';

export type LiveMutationInput<I> = I & {
  mutationId?: string;
};

export type LiveMutationSuccess<D> = {
  data: D;
  cursors: LiveCursorEntry[];
};

export type LiveMutationResult<D, E> = Result<LiveMutationSuccess<D>, E>;

export function createMutationId(): string {
  return `mutation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
