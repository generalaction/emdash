import { CheckCheckIcon, PlusIcon } from 'lucide-react';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import {
  buildContextActionText,
  buildTaskContextActions,
  type ContextAction,
} from '@renderer/features/tasks/conversations/context-actions';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Issue } from '@shared/tasks';
import { appendInitialConversationText } from './initial-conversation-text';
import { ModalContextBar } from './modal-context-bar';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
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
  projectId?: string;
}

export function InitialConversationField({ state, linkedIssue }: InitialConversationFieldProps) {
  const { value: promptLibrary } = usePromptLibrary();
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, [], promptLibrary),
    [linkedIssue, promptLibrary]
  );

  const handleActionClick = (action: ContextAction) => {
    const text = buildContextActionText(action);
    state.setPrompt((current) => appendInitialConversationText(current, text));
  };

  return (
    <>
      <Field>
        <div className="flex flex-col rounded-md border border-border">
          <Textarea
            placeholder="Start with a prompt... (optional)"
            value={state.prompt}
            onChange={(e) => state.setPrompt(e.target.value)}
            className="max-h-64 min-h-24 resize-none rounded-none border-0 focus-visible:border-0 focus-visible:ring-0"
          />
          <div className="flex w-full items-center justify-between gap-2 border-b px-2 py-1">
            <AgentSelector
              value={state.provider}
              onChange={(provider) => state.setProvider(provider)}
              connectionId={state.connectionId}
              className="h-6! w-fit rounded-none border-0 p-0! text-sm!"
            />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-xs" onClick={() => {}}>
                <PlusIcon className="size-4" />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={() => {}}>
                <CheckCheckIcon className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </Field>
    </>
  );
}
