import { describe, expect, it } from 'vitest';
import { ModelMirror } from './model-mirror';

function value<T>(v: T, sequence: number, generation = 1) {
  return { value: v, sequence, generation };
}

describe('ModelMirror', () => {
  it('applies the first snapshot and exposes value/sequence/generation', () => {
    const mirror = new ModelMirror<number>();
    expect(mirror.value).toBeNull();
    expect(mirror.sequence).toBe(-1);

    mirror.setSnapshot(value(10, 3, 5));
    expect(mirror.value).toBe(10);
    expect(mirror.sequence).toBe(3);
    expect(mirror.generation).toBe(5);
  });

  it('ignores updates with an equal or lower sequence within the same generation', () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(10, 3));
    mirror.applyUpdate(value(99, 3));
    mirror.applyUpdate(value(98, 2));
    expect(mirror.value).toBe(10);

    mirror.applyUpdate(value(20, 4));
    expect(mirror.value).toBe(20);
  });

  it('accepts a lower sequence from a newer generation and drops stale-generation messages', () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(10, 9, 1));

    mirror.applyUpdate(value(20, 1, 2));
    expect(mirror.value).toBe(20);
    expect(mirror.generation).toBe(2);

    mirror.applyUpdate(value(30, 50, 1)); // stale generation
    expect(mirror.value).toBe(20);
  });

  it('resolves waitForSequence once the target sequence is reached', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1));

    const waited = mirror.waitForSequence(3);
    mirror.applyUpdate(value(2, 2));
    let resolved = false;
    void waited.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    mirror.applyUpdate(value(3, 3));
    await waited;
    expect(resolved).toBe(true);
  });

  it('resolves waitForSequence immediately when already caught up', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 5));
    await expect(mirror.waitForSequence(5)).resolves.toBeUndefined();
  });

  it('resolves pending waiters on a generation change regardless of sequence', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1, 1));
    const waited = mirror.waitForSequence(100);
    mirror.applyUpdate(value(2, 1, 2));
    await expect(waited).resolves.toBeUndefined();
  });

  it('rejects pending waiters on dispose', async () => {
    const mirror = new ModelMirror<number>();
    mirror.setSnapshot(value(1, 1));
    const waited = mirror.waitForSequence(5);
    mirror.dispose();
    await expect(waited).rejects.toThrow(/disposed/);
  });
});
