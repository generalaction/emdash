import { cn } from '@renderer/utils/utils';
import type { BuiltinAutomationTemplate } from '@shared/core/automations/automation';
import { AutomationTemplateCard } from './AutomationTemplateCard';

interface AutomationTemplateRailProps {
  templates: BuiltinAutomationTemplate[];
  onSelect: (template: BuiltinAutomationTemplate) => void;
  compact?: boolean;
  className?: string;
}

export function AutomationTemplateRail({
  templates,
  onSelect,
  compact = false,
  className,
}: AutomationTemplateRailProps) {
  return (
    <div
      className={cn(
        'flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1',
        className
      )}
    >
      {templates.map((template) => (
        <div key={template.id} className={compact ? 'h-28 w-56 shrink-0' : 'h-32 w-64 shrink-0'}>
          <AutomationTemplateCard template={template} onSelect={onSelect} compact={compact} />
        </div>
      ))}
    </div>
  );
}
