import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { appState } from '@renderer/lib/stores/app-state';

export const FeatureAnnouncementLauncher = observer(function FeatureAnnouncementLauncher({
  active,
}: {
  active: boolean;
}) {
  const store = appState.featureAnnouncements;

  useEffect(() => {
    if (!active || store.status !== 'ready' || !store.shouldPresent) return;

    const timer = setTimeout(() => {
      store.present();
    }, 800);

    return () => clearTimeout(timer);
  }, [active, store, store.status, store.shouldPresent]);

  return null;
});
