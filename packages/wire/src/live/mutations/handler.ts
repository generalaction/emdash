import { ok, type Result } from '@emdash/shared';
import type { LiveCursorEntry } from '../protocol';
import { MutationContext } from './context';
import type { LiveModelRegistry } from './registry';

export type LiveMutationInput<I> = I & {
  mutationId?: string;
};

export type LiveMutationSuccess<D> = {
  data: D;
  cursors: LiveCursorEntry[];
};

export type LiveMutationResult<D, E> = Result<LiveMutationSuccess<D>, E>;

export type LiveMutationHandler<I, D, E> = (
  ctx: MutationContext,
  input: LiveMutationInput<I>
) => Promise<Result<D, E>> | Result<D, E>;

export function liveMutation<I, D, E>(
  registry: LiveModelRegistry,
  handler: LiveMutationHandler<I, D, E>
): (input: LiveMutationInput<I>) => Promise<LiveMutationResult<D, E>> {
  return async (input) => {
    const ctx = new MutationContext(registry, input.mutationId ?? createMutationId());
    const result = await handler(ctx, input);
    if (!result.success) return result;
    return ok({
      data: result.data,
      cursors: ctx.cursors(),
    });
  };
}

export function createMutationId(): string {
  return `mutation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
