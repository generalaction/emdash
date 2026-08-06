import { DropdownMenu } from '@emdash/ui/react/primitives';
import { ChevronDown } from 'lucide-react';
import { cn } from '@core/primitives/styling/browser/cn';
import type { BuiltinAutomationTemplate } from '../../automation-template';
import { emptyStateAutomationTemplates } from '../../builtin-catalog';

interface UseTemplateButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: BuiltinAutomationTemplate) => void;
}

export function UseTemplateButton({ open, onOpenChange, onSelect }: UseTemplateButtonProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger
        render={
          <button
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5',
              'text-xs font-medium text-foreground transition-colors hover:bg-muted/40 outline-none',
              'data-popup-open:bg-muted/40'
            )}
          />
        }
      >
        <span>Use template</span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="w-80">
        <DropdownMenu.Group>
          <DropdownMenu.Label className="px-2 py-1 text-[11px] tracking-wider uppercase">
            Templates
          </DropdownMenu.Label>
          {emptyStateAutomationTemplates.map((template) => (
            <DropdownMenu.Item
              key={template.id}
              onClick={() => onSelect(template)}
              className="flex-col items-start gap-0.5 py-1.5"
            >
              <span className="text-sm font-medium text-foreground">{template.name}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
