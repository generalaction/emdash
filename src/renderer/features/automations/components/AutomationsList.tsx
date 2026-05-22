import type { Automation, AutomationRun } from '@shared/automations/types';
import { AutomationRow } from './AutomationRow';

interface RowActions {
  onEdit: (automation: Automation) => void;
  onRunNow?: (automation: Automation) => void;
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
  onDelete?: (automation: Automation) => void;
}

interface SelectionProps {
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
}

interface AutomationsListProps extends RowActions, Partial<SelectionProps> {
  drafts: Automation[];
  active: Automation[];
  paused: Automation[];
  runsByAutomation: Map<string, AutomationRun[]>;
}

interface SectionProps extends RowActions, Partial<SelectionProps> {
  title: string;
  items: Automation[];
  runsByAutomation: Map<string, AutomationRun[]>;
}

function Section({
  title,
  items,
  runsByAutomation,
  onEdit,
  onRunNow,
  onToggleEnabled,
  onDelete,
  isSelected,
  onToggleSelect,
}: SectionProps) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">{title}</h2>
      <div>
        {items.map((automation) => (
          <AutomationRow
            key={automation.id}
            automation={automation}
            recentRuns={runsByAutomation.get(automation.id)}
            onEdit={onEdit}
            onRunNow={onRunNow}
            onToggleEnabled={onToggleEnabled}
            onDelete={onDelete}
            isSelected={isSelected?.(automation.id) ?? false}
            onToggleSelect={onToggleSelect ? () => onToggleSelect(automation.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export function AutomationsList({
  drafts,
  active,
  paused,
  runsByAutomation,
  onEdit,
  onRunNow,
  onToggleEnabled,
  onDelete,
  isSelected,
  onToggleSelect,
}: AutomationsListProps) {
  const rowActions: RowActions = { onEdit, onRunNow, onToggleEnabled, onDelete };
  const selectionProps = { isSelected, onToggleSelect };
  return (
    <div className="mb-6 space-y-5">
      <Section
        title="Drafts"
        items={drafts}
        runsByAutomation={runsByAutomation}
        {...rowActions}
        {...selectionProps}
      />
      <Section
        title="Active"
        items={active}
        runsByAutomation={runsByAutomation}
        {...rowActions}
        {...selectionProps}
      />
      <Section
        title="Paused"
        items={paused}
        runsByAutomation={runsByAutomation}
        {...rowActions}
        {...selectionProps}
      />
    </div>
  );
}
