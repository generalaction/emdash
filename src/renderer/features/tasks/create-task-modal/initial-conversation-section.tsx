import { CheckCheckIcon } from 'lucide-react';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { AddContextPopover } from '@renderer/features/tasks/conversations/add-context-popover';
import { buildTaskContextActions } from '@renderer/features/tasks/conversations/context-actions';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Button } from '@renderer/lib/ui/button';
import { Field } from '@renderer/lib/ui/field';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Issue } from '@shared/tasks';
import { appendInitialConversationText } from './initial-conversation-text';

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
}

export function InitialConversationField({ state, linkedIssue }: InitialConversationFieldProps) {
  const { value: promptLibrary } = usePromptLibrary();
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, [], promptLibrary),
    [linkedIssue, promptLibrary]
  );

  const autoApprove = state.provider ? autoApproveDefaults.getDefault(state.provider) : false;

  const handleToggleAutoApprove = () => {
    if (!state.provider) return;
    autoApproveDefaults.setDefault(state.provider, !autoApprove);
  };

  const handleActionClick = async (text: string) => {
    state.setPrompt((current) => appendInitialConversationText(current, text));
  };

  return (
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
            className="h-6! min-w-[160px] rounded-none border-0 p-0! text-sm!"
          />
          <div className="flex items-center gap-2">
            <AddContextPopover
              actions={contextActions}
              disabled={contextActions.length === 0}
              onApplyAction={handleActionClick}
            />
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleToggleAutoApprove}
                  disabled={!state.provider}
                  data-active={autoApprove || undefined}
                  className="data-active:text-foreground"
                >
                  <CheckCheckIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Auto approve</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </Field>
  );
}
