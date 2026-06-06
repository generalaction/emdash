import { CheckCircle2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { EditableNameField } from '@renderer/lib/ui/editable-name-field';
import { Field } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { SheetFooter } from '@renderer/lib/ui/sheet';
import type { Automation, BuiltinAutomationTemplate } from '@shared/automations/automation';
import type { ConversationConfig } from '@shared/automations/config';
import { formatAutomationError } from '@shared/automations/format';
import { assertValidCronTrigger } from '@shared/automations/validation';
import { useAutomations } from '../use-automations';
import { useAutomationFormState } from '../useAutomationFormState';
import { AutomationSettingsFields } from './AutomationSettingsFields';
import { SheetHeader } from './sheet-header';

export interface CreateAutomationViewProps {
  template?: BuiltinAutomationTemplate;
  onClose: () => void;
  onSaved?: (automation: Automation) => void;
}

export const CreateAutomationView = observer(function CreateAutomationView({
  template,
  onClose,
  onSaved,
}: CreateAutomationViewProps) {
  const formState = useAutomationFormState(undefined, template);
  const {
    name,
    setName,
    effectiveProjectId,
    prompt,
    provider,
    canSave,
    triggerConfig,
    buildTaskConfig,
  } = formState;

  const [error, setError] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);

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
      <SheetFooter className="flex flex-row items-center justify-end gap-2">
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
