import { appState } from '@renderer/lib/stores/app-state';
import type { FeatureAnnouncementCtaAction } from '@shared/feature-announcements/constants';

export function handleFeatureAnnouncementCtaAction(action: FeatureAnnouncementCtaAction): void {
  switch (action) {
    case 'open-automations':
      appState.navigation.navigate('automations');
      break;
  }
}
