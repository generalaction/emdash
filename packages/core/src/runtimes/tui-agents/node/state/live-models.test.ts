import { describe, expect, it } from 'vitest';
import { createTuiSessionsLiveHost } from './live-models';

describe('TUI live models', () => {
  it('executes compat cell producers once', async () => {
    const host = createTuiSessionsLiveHost();
    let calls = 0;

    host.model.states.list.produce(() => {
      calls += 1;
    });

    expect(calls).toBe(1);
    await host.dispose();
  });
});
