import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { showFeatureAnnouncementToast } from '@renderer/features/feature-announcements/feature-announcement-toast';
import { appState } from '@renderer/lib/stores/app-state';
import type { FeatureAnnouncementCtaAction } from '@shared/feature-announcements/constants';

function handleCtaAction(action: FeatureAnnouncementCtaAction): void {
  switch (action) {
    case 'open-automations':
      appState.navigation.navigate('automations');
      break;
  }
}

export const FeatureAnnouncementLauncher = observer(function FeatureAnnouncementLauncher({
  active,
}: {
  active: boolean;
}) {
  const store = appState.featureAnnouncements;

  useEffect(() => {
    const manifest = store.manifest;
    if (!active || store.status !== 'ready' || !store.shouldPresent || !manifest) return;

    const timer = setTimeout(() => {
      const isPreview = store.isPreview;
      store.markPresented();
      showFeatureAnnouncementToast(manifest, {
        onAction: handleCtaAction,
        onDismiss: () => {
          if (isPreview) {
            store.resetPresentation();
          }
        },
      });
    }, 800);

    return () => clearTimeout(timer);
  }, [active, store, store.status, store.shouldPresent, store.manifest, store.isPreview]);

  return null;
});
