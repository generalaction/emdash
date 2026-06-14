import { describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/lib/result';
import { ModelMirror } from './model-mirror';
import { OverlayStack } from './overlay-stack';

function value(v: number, sequence: number, generation = 1) {
  return { value: v, sequence, generation };
}

describe('OverlayStack', () => {
  it('shows the optimistic value until the authoritative sequence catches up', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1));
    const overlay = new OverlayStack<number>(mirror);

    const run = overlay.run(
      () => 2,
      async () => ok({ sequence: 2 }),
      (data) => data.sequence
    );
    expect(overlay.value).toBe(2); // optimistic immediately

    await run;
    expect(overlay.value).toBe(2); // still held: push has not arrived

    mirror.applyUpdate(value(2, 2)); // authoritative catches up
    expect(overlay.value).toBe(2);
    expect(overlay['overlays']).toHaveLength(0);
  });

  it('rolls back the overlay when the mutation fails', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1));
    const overlay = new OverlayStack<number>(mirror);

    await overlay.run(
      () => 2,
      async () => ({ success: false as const, error: 'boom' }),
      (data: { sequence: number }) => data.sequence
    );
    expect(overlay.value).toBe(1);
  });

  it('drops a pending overlay when the mirror generation changes', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1, 1));
    const overlay = new OverlayStack<number>(mirror);

    await overlay.run(
      () => 2,
      async () => ok({ sequence: 99 }),
      (data) => data.sequence
    );
    expect(overlay.value).toBe(2);

    // New generation with a lower sequence: the sequence target is unreachable, but the fresh
    // instance state is authoritative, so the overlay must drop.
    mirror.applyUpdate(value(5, 1, 2));
    expect(overlay.value).toBe(5);
    expect(overlay['overlays']).toHaveLength(0);
  });

  it('removes the overlay after the safety timeout', async () => {
    vi.useFakeTimers();
    try {
      const mirror = new ModelMirror<number>();
      mirror.setSnapshot(value(1, 1));
      const overlay = new OverlayStack<number>(mirror);

      await overlay.run(
        () => 2,
        async () => ok({ sequence: 99 }),
        (data) => data.sequence
      );
      expect(overlay.value).toBe(2);

      vi.advanceTimersByTime(15_000);
      expect(overlay.value).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
