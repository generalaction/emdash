import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import type { BuiltinAutomationTemplate } from '../../automation-template';
import { emptyStateAutomationTemplates } from '../../builtin-catalog';

interface UseTemplateButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: BuiltinAutomationTemplate) => void;
}

export function UseTemplateButton({ open, onOpenChange, onSelect }: UseTemplateButtonProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1 text-[11px] tracking-wider uppercase">
            Templates
          </DropdownMenuLabel>
          {emptyStateAutomationTemplates.map((template) => (
            <DropdownMenuItem
              key={template.id}
              onClick={() => onSelect(template)}
              className="flex-col items-start gap-0.5 py-1.5"
            >
              <span className="text-sm font-medium text-foreground">{template.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
