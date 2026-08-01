import { describe, expect, it } from 'vitest';
import { createTuiSessionsLiveHost, produceCell } from './live-models';

describe('TUI live models', () => {
  it('executes cell producers once', async () => {
    const host = createTuiSessionsLiveHost();
    let calls = 0;

    produceCell(host.model.states.list, () => {
      calls += 1;
    });

    expect(calls).toBe(1);
    await host.dispose();
  });
});
