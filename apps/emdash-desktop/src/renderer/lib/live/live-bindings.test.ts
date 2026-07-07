import type { LiveSnapshot, LiveUpdate } from '@emdash/core/live';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLiveModelBinding } from './live-bindings';

describe('createLiveModelBinding', () => {
  it('applies updates that arrive between attach and initial snapshot', async () => {
    type CountSnapshot = LiveSnapshot<{ count: number }>;
    const update: LiveUpdate = {
      generation: 1,
      baseSequence: 0,
      sequence: 1,
      timestamp: 1,
      delta: [{ op: 'replace', path: ['count'], value: 1 }],
    };
    let resolveSnapshot: (value: CountSnapshot) => void = () => {};
    const binding = createLiveModelBinding({
      schema: z.object({ count: z.number() }),
      snapshot: () =>
        new Promise<CountSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
      attach: async (push) => {
        push(update);
        return () => {};
      },
    });

    const started = binding.start();
    await Promise.resolve();
    resolveSnapshot({ generation: 1, sequence: 0, timestamp: 1, data: { count: 0 } });
    await started;

    expect(binding.getSnapshot()).toEqual({ count: 1 });
  });
});
