import { Clock } from 'lucide-react';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { useScheduledAutomationRun } from '../use-automations';

interface NextRunBannerProps {
  automationId: string;
}

export function NextRunBanner({ automationId }: NextRunBannerProps) {
  const { data } = useScheduledAutomationRun(automationId);
  const scheduledAt = data?.scheduledAt ?? null;

  if (!scheduledAt) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border-info bg-background-info p-2 text-foreground-info">
      <Clock className="size-3 shrink-0" aria-hidden />
      Next run scheduled <AbsoluteTime value={scheduledAt} />
    </div>
  );
}
