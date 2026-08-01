import { describe, expect, it } from 'vitest';
import { createAcpSessionsLiveHost, produceCell } from './live-models';

describe('ACP live models', () => {
  it('executes cell producers once', async () => {
    const host = createAcpSessionsLiveHost();
    let calls = 0;

    produceCell(host.model.states.list, () => {
      calls += 1;
    });

    expect(calls).toBe(1);
    await host.dispose();
  });
});
