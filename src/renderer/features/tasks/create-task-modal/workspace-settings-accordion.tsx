import { Accordion } from '@base-ui/react/accordion';
import { cn } from '@renderer/utils/utils';
import { Plus, Search } from 'lucide-react';
import { ReactNode } from 'react';

export type WorkspaceMode = 'new' | 'existing';

interface WorkspaceSettingsAccordionProps {
  value: WorkspaceMode;
  onValueChange: (value: WorkspaceMode) => void;
  newContent: React.ReactNode;
  existingContent: React.ReactNode;
}

export function WorkspaceSettingsAccordion({
  value,
  onValueChange,
  newContent,
  existingContent,
}: WorkspaceSettingsAccordionProps) {
  return (
    <Accordion.Root
      value={[value]}
      onValueChange={(vals) => {
        if (vals.length > 0) onValueChange(vals[vals.length - 1] as WorkspaceMode);
      }}
      className="w-full overflow-hidden rounded-lg border border-border"
    >
      <RadioAccordionItem
        value="new"
        currentValue={value}
        label="Create new workspace"

        className="border-b border-border"
      >
        {newContent}
      </RadioAccordionItem>
      <RadioAccordionItem
        value="existing"
        currentValue={value}
        label="Use existing workspace"
      >
        {existingContent}
      </RadioAccordionItem>
    </Accordion.Root>
  );
}

function RadioAccordionItem({
  value,
  currentValue,
  label,
  description,
  children,
  icon,
  className,
}: {
  value: string;
  currentValue: string;
  label: string;
  icon?: ReactNode
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const isOpen = currentValue === value;

  return (
    <Accordion.Item value={value} className={cn('group/item', className)}>
      <Accordion.Header>
        <Accordion.Trigger className="flex w-full items-center gap-3 p-2.5 text-left hover:bg-background-secondary-2 transition-colors group-data-open/item:border-b group-data-open/item:bg-background-secondary-2" >
          <div className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm text-foreground-muted group-data-open/item:text-foreground group-hover/item:text-foreground">
            {icon && (
              <div className="size-3 shrink-0">
                {icon}
              </div>
            )}
            <p>{label}</p>
            </span>
            {description && (
              <p className="text-xs text-foreground-muted">{description}</p>
            )}
          </div>
          {/* Radio dot — visual only, state driven by accordion */}
          <div className="relative flex size-4 shrink-0 items-center justify-center rounded-full border border-border-1 transition-colors group-data-open/item:border-primary group-data-open/item:bg-background-neutral">
            <span className="size-2 scale-0 rounded-full bg-foreground-inverse transition-transform duration-150 group-data-open/item:scale-100" />
          </div>
        </Accordion.Trigger>
      </Accordion.Header>
      {/*
        We intentionally skip Accordion.Panel here. Base UI toggles display:none
        on the panel asynchronously (after setting data-open on the item), which
        causes a one-frame flash where the content appears at full natural height
        before the grid-rows transition kicks in — the "grows too large" effect.

        Instead we drive the animation from React state (isOpen) which updates
        synchronously with the value prop, so the CSS class is applied on the
        same render as the open/close toggle. The div is always mounted, so
        overflow-hidden collapses it cleanly during the 0fr phase.
      */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-in-out',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
        aria-hidden={!isOpen}
      >
        <div className="overflow-hidden">
          <div>{children}</div>
        </div>
      </div>
    </Accordion.Item>
  );
}
