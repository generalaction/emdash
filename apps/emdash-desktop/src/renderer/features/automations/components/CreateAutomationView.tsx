import { CheckCircle2, ChevronDown } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { EditableNameField } from '@renderer/lib/ui/editable-name-field';
import { Field } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { SheetFooter } from '@renderer/lib/ui/sheet';
import type { Automation, BuiltinAutomationTemplate } from '@shared/core/automations/automation';
import { emptyStateAutomationTemplates } from '@shared/core/automations/builtin-catalog';
import type { ConversationConfig } from '@shared/core/automations/config';
import { assertValidCronTrigger } from '@shared/core/automations/validation';
import { formatAutomationError } from '../automation-run-format';
import { useAutomations } from '../use-automations';
import { useAutomationFormState } from '../useAutomationFormState';
import { AutomationSettingsFields } from './AutomationSettingsFields';
import { AutomationTemplateRail } from './AutomationTemplateRail';
import { SheetHeader } from './sheet-header';

const TEMPLATE_SECTION_COLLAPSED_KEY = 'emdash-automation-template-section-collapsed';

export interface CreateAutomationViewProps {
  onClose: () => void;
  onSaved?: (automation: Automation) => void;
  initialTemplate?: BuiltinAutomationTemplate;
}

export const CreateAutomationView = observer(function CreateAutomationView({
  onClose,
  onSaved,
  initialTemplate,
}: CreateAutomationViewProps) {
  const formState = useAutomationFormState(undefined, initialTemplate);
  const {
    name,
    setName,
    effectiveProjectId,
    prompt,
    provider,
    canSave,
    triggerConfig,
    applyTemplate,
    buildTaskConfig,
  } = formState;

  const [error, setError] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const [templatesCollapsed, setTemplatesCollapsed] = useLocalStorage(
    TEMPLATE_SECTION_COLLAPSED_KEY,
    false
  );

  const { create } = useAutomations();
  const { toast } = useToast();
  const isPending = create.isPending;

  async function handleSave() {
    if (!effectiveProjectId || !canSave) return;
    setError(null);
    const taskConfig = buildTaskConfig(effectiveProjectId);
    if (!taskConfig) return;
    try {
      assertValidCronTrigger(triggerConfig);
    } catch (validationError) {
      setCronError(formatAutomationError(validationError));
      return;
    }
    setCronError(null);
    const conversationConfig: ConversationConfig = {
      prompt: prompt.trim(),
      provider,
      autoApprove: false,
    };
    try {
      const trimmedName = name.trim();
      const saved = await create.mutateAsync({
        name: trimmedName,
        triggerConfig,
        conversationConfig,
        taskConfig,
        projectId: effectiveProjectId,
      });
      toast({
        title: 'Automation created',
        description: `"${saved.name}" is ready to go.`,
        icon: <CheckCircle2 className="size-4 text-emerald-500" aria-hidden="true" />,
      });
      onSaved?.(saved);
    } catch (saveError) {
      setError(formatAutomationError(saveError));
    }
  }

  function handleTemplateSelect(template: BuiltinAutomationTemplate) {
    applyTemplate(template);
    setError(null);
    setCronError(null);
  }

  return (
    <div className="flex h-full flex-col">
      <SheetHeader title="Create automation" onClose={onClose} />
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4">
          <Field>
            <Label>Name</Label>
            <EditableNameField
              autoFocus={name.trim().length === 0}
              value={name}
              onChange={setName}
              placeholder="Daily Pull Request Review"
              className="h-9 text-sm"
            />
          </Field>
          <AutomationSettingsFields
            state={formState}
            cronError={cronError}
            onCronExprChange={(expr) => formState.setCronExpr(expr)}
            onCronErrorClear={() => setCronError(null)}
            error={error}
          />
        </div>
      </div>
      <Collapsible
        open={!templatesCollapsed}
        onOpenChange={(open) => setTemplatesCollapsed(!open)}
        className="group border-t border-border bg-background-quaternary-1"
      >
        <CollapsibleTrigger className="flex h-9 w-full items-center justify-between gap-3 px-4 text-left text-xs font-medium text-foreground transition-colors outline-none hover:bg-background-1 focus-visible:bg-background-1">
          <span>Use a template</span>
          <ChevronDown className="size-3.5 shrink-0 text-foreground-passive transition-transform duration-150 group-data-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out">
          <div className="px-4 pb-3">
            <AutomationTemplateRail
              templates={emptyStateAutomationTemplates}
              onSelect={handleTemplateSelect}
              compact
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      <SheetFooter className="flex flex-row items-center justify-end gap-2 border-t-0">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton
          size="sm"
          onClick={() => {
            void handleSave();
          }}
          disabled={!canSave || isPending}
        >
          {isPending ? 'Saving…' : 'Create'}
        </ConfirmButton>
      </SheetFooter>
    </div>
  );
});
