import { cn } from '@renderer/utils/utils';
import type { BuiltinAutomationTemplate } from '../automation-template';
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
    <div className={cn('flex gap-2 overflow-x-auto p-4 pt-0', className)}>
      {templates.map((template) => (
        <div key={template.id} className={cn('w-56 shrink-0')}>
          <AutomationTemplateCard template={template} onSelect={onSelect} compact={compact} />
        </div>
      ))}
    </div>
  );
}
