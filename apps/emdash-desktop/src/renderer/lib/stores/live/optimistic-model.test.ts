import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { ModelMirror } from './model-mirror';
import { OptimisticModel } from './optimistic-model';

function value(v: number, sequence: number, generation = 1) {
  return { value: v, sequence, generation };
}

describe('OptimisticModel', () => {
  it('shows the optimistic value until the authoritative sequence catches up', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1));
    const optimistic = new OptimisticModel<number>(mirror);

    const run = optimistic.run(
      () => 2,
      async () => ok({ sequence: 2 }),
      (data) => data.sequence
    );
    expect(optimistic.value).toBe(2); // optimistic immediately

    await run;
    expect(optimistic.value).toBe(2); // still held: push has not arrived

    mirror.applyUpdate(value(2, 2)); // authoritative catches up
    expect(optimistic.value).toBe(2);
    expect(optimistic['optimisticUpdates']).toHaveLength(0);
  });

  it('rolls back the optimistic value when the mutation fails', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1));
    const optimistic = new OptimisticModel<number>(mirror);

    await optimistic.run(
      () => 2,
      async () => ({ success: false as const, error: 'boom' }),
      (data: { sequence: number }) => data.sequence
    );
    expect(optimistic.value).toBe(1);
  });

  it('drops a pending optimistic value when the mirror generation changes', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1, 1));
    const optimistic = new OptimisticModel<number>(mirror);

    await optimistic.run(
      () => 2,
      async () => ok({ sequence: 99 }),
      (data) => data.sequence
    );
    expect(optimistic.value).toBe(2);

    // New generation with a lower sequence: the sequence target is unreachable, but the fresh
    // instance state is authoritative, so the optimistic value must drop.
    mirror.applyUpdate(value(5, 1, 2));
    expect(optimistic.value).toBe(5);
    expect(optimistic['optimisticUpdates']).toHaveLength(0);
  });

  it('removes the optimistic value after the safety timeout', async () => {
    vi.useFakeTimers();
    try {
      const mirror = new ModelMirror<number>();
      mirror.setSnapshot(value(1, 1));
      const optimistic = new OptimisticModel<number>(mirror);

      await optimistic.run(
        () => 2,
        async () => ok({ sequence: 99 }),
        (data) => data.sequence
      );
      expect(optimistic.value).toBe(2);

      vi.advanceTimersByTime(15_000);
      expect(optimistic.value).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
