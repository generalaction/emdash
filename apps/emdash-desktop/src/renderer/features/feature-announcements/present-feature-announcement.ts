import { showFeatureAnnouncementToast } from '@renderer/features/feature-announcements/feature-announcement-toast';
import { showModal } from '@renderer/lib/modal/modal-provider';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

export function presentFeatureAnnouncement(
  manifest: FeatureAnnouncementManifest,
  onDismiss?: () => void
): void {
  const display = manifest.display ?? 'toast';

  if (display === 'modal') {
    showModal('featureAnnouncementModal', {
      manifest,
      onSuccess: () => onDismiss?.(),
      onClose: () => onDismiss?.(),
    });
    return;
  }

  showFeatureAnnouncementToast(manifest, onDismiss);
}
