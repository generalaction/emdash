import { CardGridItem } from '@renderer/lib/components/card-grid';
import type { BuiltinAutomationTemplate } from '@shared/automations/automation';

interface AutomationTemplateCardProps {
  template: BuiltinAutomationTemplate;
  onSelect: (template: BuiltinAutomationTemplate) => void;
}

export function AutomationTemplateCard({ template, onSelect }: AutomationTemplateCardProps) {
  return (
    <CardGridItem
      role="button"
      tabIndex={0}
      onClick={() => onSelect(template)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(template);
      }}
      className="h-full flex-col items-start gap-1.5 p-3"
    >
      <h3
        className="line-clamp-1 h-5 w-full min-w-0 text-sm leading-5 font-medium text-foreground"
        title={template.name}
      >
        {template.name}
      </h3>
      <p className="line-clamp-2 text-xs leading-relaxed text-foreground-muted">
        {template.description}
      </p>
    </CardGridItem>
  );
}
