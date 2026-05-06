import { useMemo, useState } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Issue } from '@shared/tasks';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { buildTaskContextActions } from '@renderer/features/tasks/conversations/context-actions';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Textarea } from '@renderer/lib/ui/textarea';
import { ModalContextBar } from './modal-context-bar';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
};

export function useInitialConversationState(connectionId?: string): InitialConversationState {
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const [prompt, setPrompt] = useState('');
  return { provider: providerId, setProvider: setProviderOverride, prompt, setPrompt };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  linkedIssue?: Issue;
  connectionId?: string;
}

export function InitialConversationField({
  state,
  linkedIssue,
  connectionId,
}: InitialConversationFieldProps) {
  const { value: reviewPrompt } = useAppSettingsKey('reviewPrompt');
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, reviewPrompt),
    [linkedIssue, reviewPrompt]
  );

  const handleActionClick = (text: string) => {
    state.setPrompt(state.prompt ? `${state.prompt}\n${text}` : text);
  };

  return (
    <Field>
      <FieldLabel>Initial Conversation</FieldLabel>
      <div className="flex flex-col border border-border rounded-md">
        <AgentSelector
          value={state.provider}
          onChange={(provider) => state.setProvider(provider)}
          connectionId={connectionId}
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
  );
}
