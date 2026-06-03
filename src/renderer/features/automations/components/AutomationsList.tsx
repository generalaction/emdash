import type { Automation, AutomationRun } from '@shared/automations/types';
import { AutomationRow } from './AutomationRow';

interface RowActions {
  onEdit: (automation: Automation) => void;
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
}

interface AutomationsListProps extends RowActions {
  drafts: Automation[];
  active: Automation[];
  paused: Automation[];
  runsByAutomation: Map<string, AutomationRun[]>;
}

interface SectionProps extends RowActions {
  title: string;
  items: Automation[];
  runsByAutomation: Map<string, AutomationRun[]>;
}

function Section({ title, items, runsByAutomation, onEdit, onToggleEnabled }: SectionProps) {
  if (items.length === 0) return null;
  return (

      <div className="py-2">
        {items.map((automation) => (
          <AutomationRow
            key={automation.id}
            automation={automation}
            recentRuns={runsByAutomation.get(automation.id)}
            onEdit={onEdit}
            onToggleEnabled={onToggleEnabled}
          />
        ))}
      </div>

  );
}

export function AutomationsList({
  drafts,
  active,
  paused,
  runsByAutomation,
  onEdit,
  onToggleEnabled,
}: AutomationsListProps) {
  const rowActions: RowActions = { onEdit, onToggleEnabled };
  return (
    <div className="mb-6 space-y-5">
      <Section title="Drafts" items={drafts} runsByAutomation={runsByAutomation} {...rowActions} />
      <Section
        title="Automations"
        items={[...active, ...paused]}
        runsByAutomation={runsByAutomation}
        {...rowActions}
      />
    </div>
  );
}
