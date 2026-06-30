import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { providerSupportsAcp } from '@shared/core/agents/agent-acp';
import { providerSupportsAutoApprove } from '@shared/core/agents/agent-auto-approve';
import type { ConversationType } from '@shared/core/conversations/conversations';
import { nextDefaultConversationTitle } from './conversation-title-utils';
import { useEffectiveProvider } from './use-effective-provider';

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<{ conversationId: string; type: ConversationType }> & {
  projectId: string;
  taskId: string;
}) {
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, setProviderOverride, createDisabled } = useEffectiveProvider(connectionId);
  const conversationMgr = conversationRegistry.get(taskId);
  const taskSettings = useTaskSettings();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoApproveOverride, setAutoApproveOverride] = useState<boolean | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [useAcpOverride, setUseAcpOverride] = useState(false);
  useCloseGuard(isSubmitting);

  const { data: agents } = useAgents();
  const modelsCapability = agents?.find((a) => a.id === providerId)?.capabilities.models;
  const modelOptions =
    modelsCapability?.kind === 'selectable' ? modelsCapability.modelOptions : null;

  const showAutoApproveToggle = providerId ? providerSupportsAutoApprove(providerId) : false;
  const showAcpToggle = providerId ? providerSupportsAcp(providerId) : false;
  const useAcp = showAcpToggle && useAcpOverride;
  const skipPermissions =
    showAutoApproveToggle && (autoApproveOverride ?? taskSettings.autoApproveByDefault);
  const titleProviderId = providerId ?? 'claude';
  const title = nextDefaultConversationTitle(
    titleProviderId,
    Array.from(conversationMgr?.conversations.values() ?? [], (conversation) => conversation.data)
  );

  // Reset model and ACP override when the provider changes (ids are provider-specific).
  const handleProviderChange = useCallback(
    (next: typeof providerId) => {
      setProviderOverride(next);
      setSelectedModel(null);
      setUseAcpOverride(false);
    },
    [setProviderOverride]
  );

  const handleCreateConversation = useCallback(async () => {
    if (createDisabled || isSubmitting || !conversationMgr || !providerId) return;
    const id = crypto.randomUUID();
    setIsSubmitting(true);
    setError(null);
    try {
      const conversationType: ConversationType = useAcp ? 'acp' : 'pty';
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: skipPermissions,
        provider: providerId,
        title,
        model: selectedModel ?? undefined,
        type: conversationType,
      });
      setIsSubmitting(false);
      onSuccess({ conversationId: id, type: conversationType });
    } catch {
      setError('Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    createDisabled,
    isSubmitting,
    providerId,
    title,
    onSuccess,
    projectId,
    taskId,
    skipPermissions,
    selectedModel,
    useAcp,
  ]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Conversation</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelector
              autoFocus
              value={providerId}
              onChange={handleProviderChange}
              connectionId={connectionId}
            />
          </Field>
          {modelOptions ? (
            <Field>
              <FieldLabel>Model</FieldLabel>
              <Select
                value={selectedModel ?? ''}
                onValueChange={(val) => setSelectedModel(val || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Default model">
                    {selectedModel
                      ? (modelOptions[selectedModel]?.name ?? selectedModel)
                      : 'Default model'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Default model</SelectItem>
                  {Object.entries(modelOptions).map(([id, opt]) => (
                    <SelectItem key={id} value={id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {showAutoApproveToggle ? (
            <Field>
              <div className="flex items-center gap-2">
                <Switch
                  checked={skipPermissions}
                  disabled={!providerId || taskSettings.loading || taskSettings.saving}
                  onCheckedChange={setAutoApproveOverride}
                />
                <FieldLabel>Auto-approve permissions</FieldLabel>
              </div>
            </Field>
          ) : null}
          {showAcpToggle ? (
            <Field>
              <div className="flex items-center gap-2">
                <Switch checked={useAcp} onCheckedChange={setUseAcpOverride} />
                <FieldLabel>Use ACP</FieldLabel>
              </div>
            </Field>
          ) : null}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton
          onClick={() => void handleCreateConversation()}
          disabled={createDisabled || isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
