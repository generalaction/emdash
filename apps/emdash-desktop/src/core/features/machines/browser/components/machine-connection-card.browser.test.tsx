import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshConfig } from '@core/primitives/ssh/api';
import { MachineConnectionRow } from './machine-connection-card';

const machine: SshConfig = {
  id: 'ssh-1',
  name: 'Orion',
  host: 'orion.example.com',
  port: 22,
  username: 'alice',
  authType: 'agent',
  useAgent: true,
};

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('MachineConnectionRow', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('offers reconnect when the workspace server is down despite live SSH', async () => {
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        <MachineConnectionRow
          machine={machine}
          state="connected"
          availability={{ kind: 'unavailable', recovery: 'eligible' }}
          onEdit={vi.fn()}
          onConnect={vi.fn()}
          onRetry={onRetry}
          onDisconnect={vi.fn()}
        />
      );
    });
    const reconnect = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Reconnect'
    );

    await act(async () => reconnect?.click());
    expect(reconnect).toBeDefined();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
