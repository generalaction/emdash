import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loopService } from '@main/core/loops/loop-service';
import { reconcileSettingsRuntimeState } from './controller';
import { appSettingsService } from './settings-service';

vi.mock('@main/core/loops/loop-service', () => ({
  loopService: { reconcileEnabledState: vi.fn() },
}));

vi.mock('./settings-service', () => ({
  appSettingsService: {
    get: vi.fn(),
    getAll: vi.fn(),
    getWithMeta: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
    resetField: vi.fn(),
  },
}));

vi.mock('@main/core/resource-monitor/resource-sampler', () => ({
  reconcileResourceSampler: vi.fn(),
}));

vi.mock('@main/core/browser/browser-profile-session', () => ({
  setBrowserCorsRelaxationSettings: vi.fn(),
}));

vi.mock('@main/core/browser/browser-webcontents-registry', () => ({
  browserWebContentsRegistry: { setKeyboardSettings: vi.fn() },
}));

describe('settings runtime reconciliation', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])(
    'applies the effective Loops setting after update/reset (%s)',
    async (loops) => {
      vi.mocked(appSettingsService.get).mockResolvedValue({ loops } as never);

      await reconcileSettingsRuntimeState('experiments');

      expect(loopService.reconcileEnabledState).toHaveBeenCalledWith(loops);
    }
  );
});
