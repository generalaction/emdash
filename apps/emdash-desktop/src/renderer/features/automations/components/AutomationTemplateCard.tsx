import type { BuiltinAutomationTemplate } from '@shared/core/automations/automation';

interface AutomationTemplateCardProps {
  template: BuiltinAutomationTemplate;
  onSelect: (template: BuiltinAutomationTemplate) => void;
  compact?: boolean;
}

export function AutomationTemplateCard({
  template,
  onSelect,
  compact = false,
}: AutomationTemplateCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="group focus-visible:border-ring focus-visible:ring-ring/50 flex h-full shrink-0 snap-start flex-col justify-between rounded-md border border-border bg-background p-3 text-left transition-colors outline-none hover:bg-background-1 focus-visible:ring-3"
    >
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="line-clamp-1 text-sm font-medium text-foreground">{template.name}</span>
        <span
          className={
            compact
              ? 'line-clamp-2 text-xs leading-relaxed text-foreground-muted'
              : 'line-clamp-3 text-xs leading-relaxed text-foreground-muted'
          }
        >
          {template.description}
        </span>
      </span>
      <span className="mt-3 line-clamp-1 text-[11px] text-foreground-passive">
        {template.category}
      </span>
    </button>
  );
}
