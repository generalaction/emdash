import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { describe, expect, it, vi } from 'vitest';
import type { Hosts } from './hosts';
import { hostSupportsLsp } from './lsp-capability';

const remote = hostRef('remote', 'remote-host');
function hosts(minor?: number) {
  return {
    get: vi.fn(() => ({
      runtime: {
        client: async () => ({
          currentHandshake: () => (minor === undefined ? undefined : { agreedMinor: minor }),
        }),
      },
    })),
  };
}
describe('language services version gate', () => {
  it('uses local services without a remote handshake', async () => {
    const registry = hosts();
    expect(await hostSupportsLsp(LOCAL_HOST_REF, registry as unknown as Hosts)).toBe(true);
    expect(registry.get).not.toHaveBeenCalled();
  });
  it.each([undefined, 0, 1, 2])('checks the negotiated minor version %s', async (minor) => {
    expect(await hostSupportsLsp(remote, hosts(minor) as unknown as Hosts)).toBe(
      minor !== undefined && minor >= 2
    );
  });
  it('rejects missing remote hosts', async () => {
    expect(await hostSupportsLsp(remote, { get: () => undefined } as unknown as Hosts)).toBe(false);
  });
});
