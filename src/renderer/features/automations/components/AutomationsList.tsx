import { Separator } from '@renderer/lib/ui/separator';
import type { Automation } from '@shared/automations/types';
import { AutomationRow } from './AutomationRow';

interface AutomationsListProps {
  automations: Automation[];
  onEdit: (automation: Automation) => void;
}

export function AutomationsList({ automations, onEdit }: AutomationsListProps) {
  if (automations.length === 0) return null;
  return (
    <div className="py-1 space-y-1">
      {automations.map((automation,index) => (
        <>
          <AutomationRow
            key={automation.id}
            automationId={automation.id}
            onClick={() => onEdit(automation)}
          />
          {
            index < automations.length - 1 && (
              <Separator key={automation.id} />
            )
          }
        </>
      ))}
    </div>
  )
}
