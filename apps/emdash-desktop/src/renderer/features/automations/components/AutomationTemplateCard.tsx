import { cn } from '@renderer/utils/utils';
import type { BuiltinAutomationTemplate } from '../automation-template';

interface AutomationTemplateCardProps {
  template: BuiltinAutomationTemplate;
  onSelect: (template: BuiltinAutomationTemplate) => void;
  compact?: boolean;
  className?: string;
}

export function AutomationTemplateCard({
  template,
  onSelect,
  compact = false,
  className,
}: AutomationTemplateCardProps) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className={cn(
        'group flex shrink-0 flex-col justify-between rounded-lg border border-border bg-background-1 p-3 text-left transition-colors outline-none hover:bg-background-2 focus-visible:ring-3',
        className
      )}
    >
      <span className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-foreground-muted" />
          <span className="line-clamp-1 text-sm text-foreground">{template.name}</span>
        </div>
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
