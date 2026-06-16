import { Label } from '@renderer/lib/ui/label';
import type { BuiltinAutomationTemplate } from '../automation-template';
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
        <Label className="text-md text-foreground">Start with a template</Label>
        <p className="max-w-xl text-sm text-foreground-muted">
          Choose a template and adjust it before creating your first automation
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {templates.map((template) => (
          <div key={template.id} className="h-full min-w-0">
            <AutomationTemplateCard
              template={template}
              onSelect={onSelectTemplate}
              className="h-full"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
