import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { getPaneContainer } from '@renderer/lib/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/lib/pty/pty-dimensions';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';

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
    conversationMgr?.createConversation({
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
