import { UpdateCard as UpdateCardUi, type UpdateStatus } from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import type React from 'react';
import { getUpdateStore } from '@core/features/updates/contributions/app-stores';
import { PRODUCT_NAME } from '@core/primitives/app-identity/api/app-identity';

export const UpdateCard = observer(function UpdateCard(): React.JSX.Element {
  const update = getUpdateStore();
  const state = update.state;

  const availableVersion =
    update.availableVersion ?? (state.status === 'available' ? state.info?.version : undefined);
  const downloadVersion = availableVersion ?? update.currentVersion;

  let status: UpdateStatus;
  switch (state.status) {
    case 'checking':
      status = { type: 'checking' };
      break;
    case 'downloading':
      status = {
        type: 'update-downloading',
        version: downloadVersion,
        progress: state.progress?.percent,
      };
      break;
    case 'available':
      status = buildDownloadAvailable(downloadVersion);
      break;
    case 'installing':
      status = { type: 'update-installing' };
      break;
    case 'downloaded':
      status = { type: 'update-install-available', onInstall: () => update.install() };
      break;
    case 'error':
      status = availableVersion ? buildDownloadAvailable(availableVersion) : { type: 'up-to-date' };
      break;
    default:
      status = { type: 'up-to-date' };
  }

  if (update.downloadRequested && (state.status === 'available' || state.status === 'error')) {
    status = { type: 'update-downloading', version: downloadVersion };
  }

  return (
    <UpdateCardUi
      currentVersion={update.currentVersion}
      appName={PRODUCT_NAME}
      status={status}
      error={
        state.status === 'error' && !update.downloadRequested
          ? { message: state.message, details: state.details }
          : undefined
      }
      onCheckForUpdates={() => update.check()}
    />
  );

  function buildDownloadAvailable(version: string): UpdateStatus {
    return {
      type: 'update-download-available',
      version,
      size: 0,
      onDownload: () => update.download(),
    };
  }
});
