import { describe, expect, it } from 'vitest';
import { createAcpSessionsLiveHost } from './live-models';

describe('ACP live models', () => {
  it('executes compat cell producers once', async () => {
    const host = createAcpSessionsLiveHost();
    let calls = 0;

    host.model.states.list.produce(() => {
      calls += 1;
    });

    expect(calls).toBe(1);
    await host.dispose();
  });
});
