import { Plus } from 'lucide-react';
import { CardGrid } from '@renderer/lib/components/card-grid';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import type { BuiltinAutomationTemplate } from '@shared/automations/automation';
import { emptyStateAutomationTemplates } from '@shared/automations/builtin-catalog';
import { AutomationTemplateCard } from './automation-template-card';

interface AutomationsEmptyStateProps {
  createPending: boolean;
  onNewAutomation: () => void;
  onSelectTemplate: (template: BuiltinAutomationTemplate) => void;
}

export function AutomationsEmptyState({
  createPending,
  onNewAutomation,
  onSelectTemplate,
}: AutomationsEmptyStateProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center py-8">
      <div className="flex max-w-xs flex-col items-center text-center">
        <h2 className="font-mono text-sm font-medium text-foreground-muted">No automations yet</h2>
        <p className="mt-1.5 text-xs leading-relaxed font-normal tracking-tight text-foreground-passive">
          Use a template or start from scratch.
        </p>
        <div className="mt-5">
          <Button size="sm" variant="outline" disabled={createPending} onClick={onNewAutomation}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Automation
          </Button>
        </div>
      </div>

      <div className="mt-10 w-full max-w-3xl">
        <div className="flex flex-col gap-2">
          <MicroLabel>Templates</MicroLabel>
          <CardGrid className="grid-cols-1 sm:grid-cols-3">
            {emptyStateAutomationTemplates.map((template) => (
              <AutomationTemplateCard
                key={template.id}
                template={template}
                onSelect={onSelectTemplate}
              />
            ))}
          </CardGrid>
        </div>
      </div>
    </div>
  );
}

export function AutomationsNoResults() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center bg-background p-8">
      <div className="flex max-w-xs flex-col items-center text-center">
        <h2 className="font-mono text-sm font-medium text-foreground-muted">No matches</h2>
        <p className="mt-1.5 text-xs leading-relaxed font-normal tracking-tight text-foreground-passive">
          No automations match your search.
        </p>
      </div>
    </div>
  );
}
