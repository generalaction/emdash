import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { conversationRegistry } from '@core/features/conversations/browser/stores/conversation-registry';
import { getProjectSshConnectionId } from '@core/features/projects/browser/stores/project-selectors';
// TODO(conversations-extraction): Pass task settings into the modal instead of importing task hooks.
import { useTaskSettings } from '@core/features/tasks/browser/hooks/useTaskSettings';
import { agentSupportsAcp, agentSupportsAutoApprove } from '@core/primitives/agents/api';
import type { ConversationType } from '@core/primitives/conversations/api';
import { defineModal } from '@core/primitives/modals/react';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import { useModalController } from '@renderer/lib/modal/api';
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
import { nextDefaultConversationTitle } from './conversation-title-utils';
import { useEffectiveProvider } from './use-effective-provider';

export const CreateConversationModal = observer(function CreateConversationModal({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { complete } = useModalController('createConversationModal');
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, setProviderOverride, createDisabled } = useEffectiveProvider(connectionId);
  const conversationMgr = conversationRegistry.get(taskId);
  const taskSettings = useTaskSettings();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoApproveOverride, setAutoApproveOverride] = useState<boolean | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [useChatUiPreference, setUseChatUiPreference] = useLocalStorage(
    'initial-conversation:chat-ui-enabled',
    false
  );
  useCloseGuard(isSubmitting);

  const { data: agents } = useAgents();
  const selectedAgent = agents?.find((a) => a.id === providerId);
  const modelsCapability = selectedAgent?.capabilities.models;
  const modelOptions =
    modelsCapability?.kind === 'selectable' ? modelsCapability.modelOptions : null;

  const showAutoApproveToggle = agentSupportsAutoApprove(selectedAgent?.capabilities);
  const showAcpToggle = agentSupportsAcp(selectedAgent?.capabilities);
  const useAcp = showAcpToggle && useChatUiPreference;
  const skipPermissions =
    showAutoApproveToggle && (autoApproveOverride ?? taskSettings.autoApproveByDefault);
  const title = providerId
    ? nextDefaultConversationTitle(
        providerId,
        Array.from(
          conversationMgr?.conversations.values() ?? [],
          (conversation) => conversation.data
        )
      )
    : 'Conversation';

  // Reset model when the provider changes (ids are provider-specific).
  const handleProviderChange = useCallback(
    (next: typeof providerId) => {
      setProviderOverride(next);
      setSelectedModel(null);
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
      complete({ conversationId: id, type: conversationType });
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
    complete,
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
                <Switch checked={useAcp} onCheckedChange={setUseChatUiPreference} />
                <FieldLabel>Use chat UI</FieldLabel>
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

export const createConversationModal = defineModal<{
  conversationId: string;
  type: ConversationType;
}>()({
  id: 'createConversationModal',
  component: CreateConversationModal,
});
