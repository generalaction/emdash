import {
  CalendarClock,
  Check,
  ListChecks,
  MessageSquare,
  Shield,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureAnnouncementIcon } from '@shared/feature-announcements/schema';

const ICONS: Record<FeatureAnnouncementIcon, LucideIcon> = {
  'calendar-clock': CalendarClock,
  'list-checks': ListChecks,
  shield: Shield,
  check: Check,
  sparkles: Sparkles,
  'message-square': MessageSquare,
};

export function getFeatureAnnouncementIcon(icon: FeatureAnnouncementIcon): LucideIcon {
  return ICONS[icon];
}
