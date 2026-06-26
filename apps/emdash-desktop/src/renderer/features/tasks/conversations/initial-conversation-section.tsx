import { CheckCheckIcon, ChevronDownIcon, PlusIcon, X } from 'lucide-react';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { Button } from '@renderer/lib/ui/button';
import { Field } from '@renderer/lib/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { providerSupportsAutoApprove } from '@shared/core/agents/agent-auto-approve';
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
  autoApprove: boolean;
  setAutoApprove: (autoApprove: boolean) => void;
  /** Selected model id, or null to use the agent CLI default. */
  model: string | null;
  setModel: (model: string | null) => void;
  connectionId?: string;
};

interface InitialConversationStateOptions {
  resetPromptOnProjectChange?: boolean;
}

export function useInitialConversationState(
  projectId?: string,
  initialProvider?: AgentProviderId,
  autoApproveByDefault = false,
  options: InitialConversationStateOptions = {}
): InitialConversationState {
  const { resetPromptOnProjectChange = true } = options;
  const connectionId = projectId ? getProjectSshConnectionId(projectId) : undefined;
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId, initialProvider);
  const [prompt, setPrompt] = useState('');
  const [issueContext, setIssueContext] = useState<string | null>(null);
  const [autoApproveOverride, setAutoApproveOverride] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const [prevProjectId, setPrevProjectId] = useState(projectId);
  const [prevProviderId, setPrevProviderId] = useState(providerId);
  const projectChanged = projectId !== prevProjectId;
  const providerChanged = providerId !== prevProviderId;

  if (projectChanged) {
    setPrevProjectId(projectId);
    setProviderOverride(null);
    if (resetPromptOnProjectChange) {
      setPrompt('');
    }
    setIssueContext(null);
    setAutoApproveOverride(null);
    setModel(null);
  } else if (providerChanged) {
    setPrevProviderId(providerId);
    setModel(null);
  }

  const autoApproveSupported = providerId ? providerSupportsAutoApprove(providerId) : false;
  const autoApprove = autoApproveSupported && (autoApproveOverride ?? autoApproveByDefault);

  return {
    provider: providerId,
    setProvider: setProviderOverride,
    projectId,
    prompt,
    setPrompt,
    issueContext,
    setIssueContext,
    autoApprove,
    setAutoApprove: setAutoApproveOverride,
    model,
    setModel,
    connectionId,
  };
}

function useModelOptions(
  providerId: AgentProviderId | null
): Record<string, { name: string }> | null {
  const { data: agents } = useAgents();
  if (!providerId) return null;
  const models = agents?.find((a) => a.id === providerId)?.capabilities.models;
  return models?.kind === 'selectable' ? models.modelOptions : null;
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  linkedIssue?: LinkedIssue;
  includeIssueContextByDefault: boolean;
  onPromptBlur?: () => void;
  placeholder?: string;
  textareaClassName?: string;
  showAutoApproveToggle?: boolean;
}

export function InitialConversationField({
  state,
  linkedIssue,
  includeIssueContextByDefault,
  onPromptBlur,
  placeholder,
  textareaClassName,
  showAutoApproveToggle = true,
}: InitialConversationFieldProps) {
  const { value: promptLibrary } = usePromptLibrary();
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, [], promptLibrary),
    [linkedIssue, promptLibrary]
  );
  const modelOptions = useModelOptions(state.provider);

  // Auto-inject issue context whenever the linked issue changes.
  useEffect(() => {
    state.setIssueContext(
      includeIssueContextByDefault && linkedIssue ? buildIssueContextText(linkedIssue) : null
    );
    // oxlint-disable-next-line react/exhaustive-deps
  }, [includeIssueContextByDefault, linkedIssue?.identifier, linkedIssue?.provider]);

  const canToggleAutoApprove = state.provider ? providerSupportsAutoApprove(state.provider) : false;

  const handleToggleAutoApprove = () => {
    if (!state.provider) return;
    state.setAutoApprove(!state.autoApprove);
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
          'flex flex-col rounded-lg border border-border transition-colors',
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
            {modelOptions ? (
              <Select
                value={state.model ?? ''}
                onValueChange={(val) => state.setModel(val || null)}
              >
                <SelectTrigger className="h-6 gap-1 border-0 px-1 py-0 text-xs shadow-none focus:ring-0">
                  <SelectValue placeholder="Default model">
                    {state.model
                      ? (modelOptions[state.model]?.name ?? state.model)
                      : 'Default model'}
                  </SelectValue>
                  <ChevronDownIcon className="size-3 opacity-60" />
                </SelectTrigger>
                <SelectContent className="min-w-40">
                  <SelectItem value="">Default model</SelectItem>
                  {Object.entries(modelOptions).map(([id, opt]) => (
                    <SelectItem key={id} value={id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
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
            {showAutoApproveToggle && canToggleAutoApprove ? (
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleToggleAutoApprove}
                    disabled={!state.provider}
                    data-active={state.autoApprove || undefined}
                    className="transition-colors data-active:bg-background-destructive data-active:text-foreground-destructive"
                  >
                    <CheckCheckIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Auto approve</TooltipContent>
              </Tooltip>
            ) : null}
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
              <PopoverContent side="bottom" align="start" sideOffset={6} className="w-80 gap-0 p-2">
                <Textarea
                  value={state.issueContext ?? ''}
                  onChange={(e) => state.setIssueContext(e.target.value || null)}
                  placeholder="Edit the issue context sent to the agent..."
                  className="max-h-64 min-h-32 resize-none font-mono text-xs"
                />
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
