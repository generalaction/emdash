import { showFeatureAnnouncementToast } from '@renderer/features/feature-announcements/feature-announcement-toast';
import type { FeatureAnnouncementManifest } from '@shared/feature-announcements/schema';

export function presentFeatureAnnouncement(
  manifest: FeatureAnnouncementManifest,
  onDismiss?: () => void
): void {
  showFeatureAnnouncementToast(manifest, onDismiss);
}
