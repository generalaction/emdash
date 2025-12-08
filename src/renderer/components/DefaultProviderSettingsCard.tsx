import React, { useCallback, useEffect, useState } from 'react';
import { ProviderSelector } from './ProviderSelector';
import type { Provider } from '../types';
import { isValidProviderId } from '@shared/providers/registry';

const DEFAULT_PROVIDER: Provider = 'claude';

const DefaultProviderSettingsCard: React.FC = () => {
  const [defaultProvider, setDefaultProvider] = useState<Provider>(DEFAULT_PROVIDER);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings?.defaultProvider) {
        const provider = res.settings.defaultProvider;
        setDefaultProvider(isValidProviderId(provider) ? (provider as Provider) : DEFAULT_PROVIDER);
      } else {
        setDefaultProvider(DEFAULT_PROVIDER);
      }
    } catch {
      setDefaultProvider(DEFAULT_PROVIDER);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (provider: Provider) => {
    setSaving(true);
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('default_provider_changed', { provider });
    });
    try {
      const res = await window.electronAPI.updateSettings({ defaultProvider: provider });
      if (res?.success && res.settings?.defaultProvider) {
        setDefaultProvider(res.settings.defaultProvider as Provider);
      }
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>The provider that will be selected by default when creating a new task.</div>
      </div>
      <div className="w-full max-w-xs">
        <ProviderSelector
          value={defaultProvider}
          onChange={(provider) => {
            setDefaultProvider(provider);
            void save(provider);
          }}
          disabled={loading || saving}
          className="w-full"
        />
      </div>
    </div>
  );
};

export default DefaultProviderSettingsCard;
