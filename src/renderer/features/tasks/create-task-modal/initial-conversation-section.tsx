import { useMemo, useState } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Issue } from '@shared/tasks';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { buildTaskContextActions } from '@renderer/features/tasks/conversations/context-actions';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { ModalContextBar } from './modal-context-bar';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  connectionId?: string;
};

export function useInitialConversationState(projectId?: string): InitialConversationState {
  const connectionId = projectId ? getProjectSshConnectionId(projectId) : undefined;
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const [prompt, setPrompt] = useState('');
  return {
    provider: providerId,
    setProvider: setProviderOverride,
    prompt,
    setPrompt,
    connectionId,
  };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  linkedIssue?: Issue;
}

export function InitialConversationField({ state, linkedIssue }: InitialConversationFieldProps) {
  const { value: reviewPrompt } = useAppSettingsKey('reviewPrompt');
  const { value: promptLibrary } = useAppSettingsKey('promptLibrary');
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, reviewPrompt, undefined, promptLibrary),
    [linkedIssue, reviewPrompt, promptLibrary]
  );

  const handleActionClick = (text: string) => {
    state.setPrompt(state.prompt ? `${state.prompt}\n${text}` : text);
  };

  return (
    <>
      <Field>
        <FieldLabel>Initial conversation</FieldLabel>
        <div className="flex flex-col border border-border rounded-md">
          <AgentSelector
            value={state.provider}
            onChange={(provider) => state.setProvider(provider)}
            connectionId={state.connectionId}
            className="rounded-none border-0 border-b"
          />
          <Textarea
            placeholder="Start with a prompt... (optional)"
            value={state.prompt}
            onChange={(e) => state.setPrompt(e.target.value)}
            className="min-h-24 resize-none border-0 rounded-none focus-visible:ring-0 focus-visible:border-0"
          />
          <ModalContextBar actions={contextActions} onActionClick={handleActionClick} />
        </div>
      </Field>
      <Field>
        <div className="flex items-center gap-2">
          <Switch
            checked={state.provider ? autoApproveDefaults.getDefault(state.provider) : false}
            disabled={!state.provider || autoApproveDefaults.loading || autoApproveDefaults.saving}
            onCheckedChange={(checked) => {
              if (state.provider) autoApproveDefaults.setDefault(state.provider, checked);
            }}
          />
          <FieldLabel>Auto-approve permissions</FieldLabel>
        </div>
      </Field>
    </>
  );
}
