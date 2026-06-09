import type { BuiltinAutomationTemplate } from '@shared/core/automations/automation';
import { AutomationTemplateCard } from './AutomationTemplateCard';

interface AutomationTemplatesEmptyStateProps {
  templates: BuiltinAutomationTemplate[];
  onSelectTemplate: (template: BuiltinAutomationTemplate) => void;
}

export function AutomationTemplatesEmptyState({
  templates,
  onSelectTemplate,
}: AutomationTemplatesEmptyStateProps) {
  return (
    <section className="flex flex-col gap-4 py-8">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">Start with a template</h3>
        <p className="max-w-xl text-sm text-foreground-muted">
          Choose a scheduled workflow and adjust it before creating your first automation.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {templates.map((template) => (
          <div key={template.id} className="h-32 min-w-0">
            <AutomationTemplateCard template={template} onSelect={onSelectTemplate} />
          </div>
        ))}
      </div>
    </section>
  );
}
