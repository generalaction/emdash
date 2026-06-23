import { showFeatureAnnouncementToast } from '@renderer/features/feature-announcements/feature-announcement-toast';
import { appState } from '@renderer/lib/stores/app-state';
import type { FeatureAnnouncementCtaAction } from '@shared/feature-announcements/constants';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

function handleCtaAction(action: FeatureAnnouncementCtaAction): void {
  switch (action) {
    case 'open-automations':
      appState.navigation.navigate('automations');
      break;
  }
}

export function presentFeatureAnnouncement(
  manifest: FeatureAnnouncementManifest,
  options?: { onDismiss?: () => void }
): void {
  showFeatureAnnouncementToast(manifest, {
    onAction: handleCtaAction,
    onDismiss: options?.onDismiss,
  });
}
