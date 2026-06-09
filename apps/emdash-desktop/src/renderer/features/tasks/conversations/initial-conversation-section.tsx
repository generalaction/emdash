import { CheckCheckIcon, PlusIcon, X } from 'lucide-react';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Button } from '@renderer/lib/ui/button';
import { Field } from '@renderer/lib/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { LinkedIssue } from '@shared/core/linked-issue';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import { appendInitialConversationText } from '../create-task-modal/initial-conversation-text';
import { usePromptFileDrop } from '../create-task-modal/use-prompt-file-drop';
import { AddContextPopover } from './add-context-popover';
import { buildIssueContextText, buildTaskContextActions } from './context-actions';
import { useEffectiveProvider } from './use-effective-provider';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  projectId?: string;
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  issueContext: string | null;
  setIssueContext: (ctx: string | null) => void;
  connectionId?: string;
};

export function useInitialConversationState(
  projectId?: string,
  initialProvider?: AgentProviderId
): InitialConversationState {
  const connectionId = projectId ? getProjectSshConnectionId(projectId) : undefined;
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId, initialProvider);
  const [prompt, setPrompt] = useState('');
  const [issueContext, setIssueContext] = useState<string | null>(null);

  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    setProviderOverride(null);
    setPrompt('');
    setIssueContext(null);
  }

  return {
    provider: providerId,
    setProvider: setProviderOverride,
    projectId,
    prompt,
    setPrompt,
    issueContext,
    setIssueContext,
    connectionId,
  };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  linkedIssue?: LinkedIssue;
  includeIssueContextByDefault: boolean;
  onPromptBlur?: () => void;
  placeholder?: string;
  textareaClassName?: string;
}

export function InitialConversationField({
  state,
  linkedIssue,
  includeIssueContextByDefault,
  onPromptBlur,
  placeholder,
  textareaClassName,
}: InitialConversationFieldProps) {
  const { value: promptLibrary } = usePromptLibrary();
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, [], promptLibrary),
    [linkedIssue, promptLibrary]
  );

  // Auto-inject issue context whenever the linked issue changes.
  useEffect(() => {
    state.setIssueContext(
      includeIssueContextByDefault && linkedIssue ? buildIssueContextText(linkedIssue) : null
    );
    // oxlint-disable-next-line react/exhaustive-deps
  }, [includeIssueContextByDefault, linkedIssue?.identifier, linkedIssue?.provider]);

  const autoApprove = state.provider ? autoApproveDefaults.getDefault(state.provider) : false;

  const handleToggleAutoApprove = () => {
    if (!state.provider) return;
    autoApproveDefaults.setDefault(state.provider, !autoApprove);
  };

  const handleActionClick = async (text: string) => {
    state.setPrompt((current) => appendInitialConversationText(current, text));
  };

  const { isDragOver, dropHandlers } = usePromptFileDrop({
    // Local paths would not exist on the remote host of an SSH project.
    disableLocalFiles: Boolean(state.connectionId),
    workspaceId: state.projectId,
    onDropText: (text) =>
      state.setPrompt((current) => appendInitialConversationText(current, text)),
  });

  return (
    <Field>
      <div
        className={cn(
          'flex flex-col rounded-md border border-border transition-colors',
          isDragOver && 'bg-accent/10 ring-2 ring-accent/50 ring-inset'
        )}
        {...dropHandlers}
      >
        <div className="flex w-full items-center justify-between gap-2 px-2 pt-1">
          <AgentSelector
            value={state.provider}
            onChange={(provider) => state.setProvider(provider)}
            connectionId={state.connectionId}
            className="h-6! w-fit! rounded-none border-0 p-0! text-sm!"
            contentClassName="w-64"
          />
          <div className="flex items-center gap-2">
            <AddContextPopover
              actions={contextActions}
              disabled={contextActions.length === 0}
              onApplyAction={handleActionClick}
              renderTrigger={({ disabled: isDisabled }) => (
                <Button variant="ghost" size="icon-xs" disabled={isDisabled}>
                  <PlusIcon className="size-4" />
                </Button>
              )}
            />
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleToggleAutoApprove}
                  disabled={!state.provider}
                  data-active={autoApprove || undefined}
                  className="transition-colors data-active:bg-background-destructive data-active:text-foreground-destructive"
                >
                  <CheckCheckIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Auto approve</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Issue context pill */}
        {state.issueContext && linkedIssue && (
          <div className="px-2 py-1">
            <Popover>
              <PopoverTrigger
                className={cn(
                  'group relative flex items-center gap-1.5 rounded bg-background-2 py-0.5 pr-6 pl-2 text-xs text-foreground-muted',
                  'hover:bg-background-3 cursor-pointer'
                )}
              >
                <ProviderLogo provider={linkedIssue.provider} className="size-3 shrink-0" />
                <span className="font-mono">{linkedIssue.identifier}</span>
                {linkedIssue.title && (
                  <span className="max-w-48 truncate text-foreground-passive">
                    {linkedIssue.title}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    state.setIssueContext(null);
                  }}
                  className={cn(
                    'absolute right-1 flex items-center justify-center rounded p-0.5',
                    'text-foreground-passive opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100'
                  )}
                >
                  <X className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" sideOffset={6} className="w-80 gap-0 p-0">
                <pre className="p-3 font-mono text-xs whitespace-pre-wrap text-foreground-passive">
                  {state.issueContext}
                </pre>
              </PopoverContent>
            </Popover>
          </div>
        )}

        <Textarea
          placeholder={placeholder ?? 'Add an optional initial message...'}
          value={state.prompt}
          onChange={(e) => state.setPrompt(e.target.value)}
          onBlur={onPromptBlur}
          className={cn(
            'max-h-64 min-h-8 resize-none rounded-none border-0 focus-visible:border-0 focus-visible:ring-0',
            textareaClassName
          )}
        />
      </div>
    </Field>
  );
}
