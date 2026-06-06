import { Fragment } from 'react';
import { Separator } from '@renderer/lib/ui/separator';
import type { Automation } from '@shared/automations/automation';
import { AutomationRow } from './AutomationRow';

interface AutomationsListProps {
  automations: Automation[];
  onEdit: (automation: Automation) => void;
  onToggleEnabled: (automation: Automation, enabled: boolean) => void;
}

export function AutomationsList({ automations, onEdit, onToggleEnabled }: AutomationsListProps) {
  return (
    <div className="space-y-1 py-1">
      {automations.map((automation) => (
        <Fragment key={automation.id}>
          <AutomationRow
            automation={automation}
            onToggleEnabled={(enabled) => onToggleEnabled(automation, enabled)}
            onClick={() => onEdit(automation)}
          />
          <Separator />
        </Fragment>
      ))}
    </div>
  );
}
