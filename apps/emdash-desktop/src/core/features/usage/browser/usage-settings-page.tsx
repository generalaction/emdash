import { remote, type RemoteModel } from '@emdash/wire/state';
import { useState } from 'react';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import { getUsageClient } from '../api/browser/client';
import { usageContract } from '../api/contract';
import { UsageOverviewView } from './usage-overview-view';

let modelPromise: Promise<RemoteModel<typeof usageContract.overview>> | undefined;
function getModel() {
  modelPromise ??= getUsageClient().then((client) =>
    remote(usageContract.overview, client.overview, { lingerMs: 15_000 })
  );
  return modelPromise;
}

export function UsageSettingsPage() {
  const state = useRemoteModelState(usageContract.overview, getModel, undefined, 'current');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const { navigate } = useNavigate();
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      if (state.error) await state.refresh();
      await (await getUsageClient()).refresh(undefined, { timeoutMs: 45_000 });
    } catch {
      setRefreshError('Could not refresh usage. Try again.');
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <UsageOverviewView
      overview={state.value}
      loading={state.isLoading}
      refreshing={refreshing}
      error={refreshError ?? (state.error ? 'Could not load usage. Try refreshing.' : undefined)}
      onRefresh={() => {
        void refresh();
      }}
      onMachines={() => navigate(settingsViewDef({ tab: 'connections' }))}
    />
  );
}
