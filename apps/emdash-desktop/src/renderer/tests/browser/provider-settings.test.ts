import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { deferred } from '@emdash/shared/testing';
import { createController, defineContract } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { expect, it, vi } from 'vitest';
import {
  patchProviderSettings,
  readProviderSettings,
} from '@core/features/conversations/api/browser/provider-preferences';
import { conversationsContract } from '@core/features/conversations/api/contract';
import {
  emptyProviderSettings,
  type ProviderPreferencePatch,
  type ProviderSettingsSnapshot,
} from '@core/features/conversations/api/provider-settings';

const connection = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => connection.client,
}));

it('shares pending selections across creation scopes and waits for their durable writes', async () => {
  const contract = defineContract({ providerSettings: conversationsContract.providerSettings });
  let saved: ProviderSettingsSnapshot = structuredClone(emptyProviderSettings);
  const state = cell(saved);
  const model = expose(contract.providerSettings.model, { value: () => state });
  const firstSave = deferred<void>();
  const patch = vi.fn(async ({ patch }: { patch: ProviderPreferencePatch }) => {
    await firstSave.promise;
    saved =
      patch.transport === 'acp'
        ? { ...saved, acp: { ...saved.acp, options: { ...saved.acp.options, ...patch.options } } }
        : { ...saved, pty: { ...saved.pty, autoApprove: patch.autoApprove } };
    state.set(saved);
    return saved;
  });
  const wire = createTestWire(
    contract,
    createController(
      contract,
      {
        providerSettings: {
          model,
          patch,
        },
      },
      { validate: 'full' }
    )
  );
  connection.client = wire.client;
  const key = { host: formatHostRef(LOCAL_HOST_REF), providerId: 'pending-test', projectId: 'a' };
  try {
    await readProviderSettings(key);
    await readProviderSettings({ ...key, projectId: 'b' });
    const save = patchProviderSettings(key, {
      transport: 'acp',
      options: { model: 'astra', effort: 'xhigh' },
    });
    let created = false;
    const creation = readProviderSettings({ ...key, projectId: 'b' }).then((settings) => {
      created = true;
      return settings;
    });
    await vi.waitFor(() => expect(patch).toHaveBeenCalledOnce());
    expect(created).toBe(false);
    firstSave.resolve();
    await save;
    expect(await creation).toMatchObject({
      acp: { options: { model: 'astra', effort: 'xhigh' } },
    });
  } finally {
    firstSave.resolve();
    await model.dispose();
    await wire.dispose();
  }
});
