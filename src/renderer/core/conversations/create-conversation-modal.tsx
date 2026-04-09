import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { AgentSelector } from '@renderer/components/agent-selector/agent-selector';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { Switch } from '@renderer/components/ui/switch';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { useAppSettingsKey } from '@renderer/core/settings/use-app-settings-key';
import { getProjectStore } from '@renderer/core/stores/project-selectors';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';

function getConversationsPaneSize() {
  const container = getPaneContainer('conversations');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<{ conversationId: string }> & {
  projectId: string;
  taskId: string;
}) {
  const [providerId, setProviderId] = useState<AgentProviderId>('claude');
  const projectData = getProjectStore(projectId)?.data;
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;
  const conversationMgr = asProvisioned(getTaskStore(projectId, taskId))?.conversations;
  const { value: taskSettings } = useAppSettingsKey('tasks');
  const defaultSkipPermissions = taskSettings?.autoApproveByDefault ?? false;
  const [skipPermissionsOverride, setSkipPermissionsOverride] = useState<boolean | undefined>(
    undefined
  );
  const skipPermissions = skipPermissionsOverride ?? defaultSkipPermissions;

  const providerIdConversationsCount = useMemo(() => {
    if (!conversationMgr) return 0;
    return Array.from(conversationMgr.conversations.values()).filter(
      (c) => c.data.providerId === providerId
    ).length;
  }, [conversationMgr, conversationMgr?.conversations.size, providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = useMemo(() => {
    return `${providerId} (${providerIdConversationsCount + 1})`;
  }, [providerId, providerIdConversationsCount]);

  const handleCreateConversation = useCallback(() => {
    const id = crypto.randomUUID();
    void conversationMgr?.createConversation({
      projectId,
      taskId,
      id,
      autoApprove: skipPermissions,
      provider: providerId,
      title,
      initialSize: getConversationsPaneSize(),
    });
    onSuccess({ conversationId: id });
  }, [conversationMgr, providerId, title, onSuccess, projectId, taskId, skipPermissions]);

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
              value={providerId}
              onChange={setProviderId}
              connectionId={connectionId}
            />
          </Field>
          <Field>
            <div className="flex items-center gap-2">
              <Switch checked={skipPermissions} onCheckedChange={setSkipPermissionsOverride} />
              <FieldLabel>Dangerously skip permissions</FieldLabel>
            </div>
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton onClick={handleCreateConversation}>Create</ConfirmButton>
      </DialogFooter>
    </>
  );
});
