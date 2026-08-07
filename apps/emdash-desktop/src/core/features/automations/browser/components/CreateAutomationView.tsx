import {
  Button,
  Collapsible,
  Field,
  Input,
  Label,
  Sheet,
  useToast,
} from '@emdash/ui/react/primitives';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { Automation } from '@core/primitives/automations/api';
import type { ConversationConfig } from '@core/primitives/automations/api';
import { assertValidCronTrigger } from '@core/primitives/automations/api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { useLocalStorage } from '@core/primitives/react-hooks/browser/useLocalStorage';
import { formatAutomationError } from '../automation-run-format';
import type { BuiltinAutomationTemplate } from '../automation-template';
import { emptyStateAutomationTemplates } from '../builtin-catalog';
import { useAutomationTargetAvailability, useCreateAutomation } from '../use-automations';
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

  const create = useCreateAutomation();
  const availability = useAutomationTargetAvailability(effectiveProjectId);
  const runtimeAvailable = availability.data?.available === true;
  const canCreate = canSave && runtimeAvailable;
  const { toast } = useToast();
  const isPending = create.isPending;

  async function handleSave() {
    if (!effectiveProjectId || !provider || !canCreate) return;
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
    const useChatUi = formState.initialConversation.useChatUi;
    const conversationConfig: ConversationConfig = {
      prompt: prompt.trim(),
      provider,
      autoApprove: false,
      model: formState.model ?? undefined,
      type: useChatUi ? 'acp' : 'pty',
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
      toast('Automation created', {
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
          <Field.Root>
            <Label>Name</Label>
            <Input
              bare
              autoFocus={name.trim().length === 0}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily Pull Request Review"
              className="h-9 px-0 text-lg!"
            />
          </Field.Root>
          <AutomationSettingsFields
            state={formState}
            cronError={cronError}
            onCronExprChange={(expr) => formState.setCronExpr(expr)}
            onCronErrorClear={() => setCronError(null)}
            error={error}
          />
          {availability.data?.available === false && effectiveProjectId && (
            <p className="rounded-md bg-background-warning px-3 py-2 text-xs text-foreground-warning">
              {availability.data.reason}
            </p>
          )}
        </div>
      </div>
      <Collapsible.Root
        open={!templatesCollapsed}
        onOpenChange={(open) => setTemplatesCollapsed(!open)}
        className="group border-t border-border bg-background"
      >
        <div className="flex w-full items-center justify-between gap-3 p-4 py-3">
          <Label>Use a template</Label>

          <Collapsible.Trigger
            hideChevron
            render={
              <Button variant="ghost" size="xs" icon>
                <ChevronDown className="size-3.5 shrink-0 text-foreground-passive transition-transform duration-150 group-data-open:rotate-180" />
              </Button>
            }
          ></Collapsible.Trigger>
        </div>
        <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out">
          <AutomationTemplateRail
            templates={emptyStateAutomationTemplates}
            onSelect={handleTemplateSelect}
            compact
          />
        </Collapsible.Panel>
      </Collapsible.Root>
      <Sheet.Footer className="flex flex-row items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton
          variant="primary"
          size="sm"
          onClick={() => {
            void handleSave();
          }}
          disabled={!canCreate || isPending}
        >
          {isPending ? 'Saving…' : 'Create'}
        </ConfirmButton>
      </Sheet.Footer>
    </div>
  );
});
