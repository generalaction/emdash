import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { presentFeatureAnnouncement } from '@renderer/features/feature-announcements/present-feature-announcement';
import { appState } from '@renderer/lib/stores/app-state';

export const FeatureAnnouncementLauncher = observer(function FeatureAnnouncementLauncher({
  active,
}: {
  active: boolean;
}) {
  const store = appState.featureAnnouncements;

  useEffect(() => {
    const manifest = store.manifest;
    if (
      !active ||
      store.isPreview ||
      store.status !== 'ready' ||
      !store.shouldPresent ||
      !manifest
    ) {
      return;
    }

    const timer = setTimeout(() => {
      store.markPresented();
      presentFeatureAnnouncement(manifest);
    }, 800);

    return () => clearTimeout(timer);
  }, [active, store, store.status, store.shouldPresent, store.manifest, store.isPreview]);

  return null;
});
