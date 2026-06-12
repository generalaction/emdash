import { Send, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import {
  formatConversationTitleForDisplay,
  nextDefaultConversationTitle,
} from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import {
  useConversations,
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { pastePromptInjection } from '@renderer/lib/pty/prompt-injection';
import { Button } from '@renderer/lib/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { buildAnnotationPrompt } from './browser-annotation-prompt';
import type { BrowserAnnotationState } from './browser-annotation-store';

export const BrowserAnnotationBar = observer(function BrowserAnnotationBar({
  state,
  onSent,
  onClearAll,
}: {
  state: BrowserAnnotationState;
  onSent: () => void;
  onClearAll: () => void;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const conversations = useConversations();
  const taskView = useWorkspaceViewModel();
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId: newConversationProviderId, createDisabled } =
    useEffectiveProvider(connectionId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // No useMemo: the conversations map is a stable MobX observable.map instance, so a
  // memo would never recompute and would drop the observer subscription entirely.
  const options = Array.from(conversations.conversations.values())
    .map((store) => ({
      id: store.data.id,
      title: store.data.title,
      providerId: store.data.providerId,
      lastInteractedAt: store.data.lastInteractedAt ?? '',
    }))
    .sort((a, b) => b.lastInteractedAt.localeCompare(a.lastInteractedAt));

  const hasConversations = options.length > 0;
  const targetOption =
    (selectedId ? options.find((option) => option.id === selectedId) : undefined) ?? options[0];
  const targetId = targetOption?.id ?? null;
  const count = state.annotations.length;
  const canSend =
    count > 0 &&
    !isSending &&
    (hasConversations ? targetId !== null : newConversationProviderId !== null && !createDisabled);

  const sendToExisting = async () => {
    if (!targetId) throw new Error('No conversation selected');
    const session = conversations.sessions.get(targetId);
    const conversation = conversations.conversations.get(targetId);
    if (!session || !conversation) throw new Error('Conversation unavailable');

    // The target may be dehydrated (tab closed → PTY killed). Hydrating is
    // idempotent: the session supervisor ignores it when the PTY is running.
    await conversations.hydrateConversation(targetId);

    const text = buildAnnotationPrompt(state.annotations.slice());
    let delivered = true;
    const sendInput = async (data: string) => {
      const result = await rpc.pty.sendInput(session.sessionId, data);
      if (!result.success) delivered = false;
      return result;
    };
    await pastePromptInjection({
      providerId: conversation.data.providerId,
      text,
      forceBracketedPaste: true,
      sendInput,
    });
    if (delivered) {
      const submit = await rpc.pty.sendInput(session.sessionId, '\r');
      delivered = submit.success;
    }
    if (!delivered) throw new Error('Agent session is not running');
    conversation.setWorking();
  };

  const sendToNewConversation = async () => {
    if (!newConversationProviderId || createDisabled) return;
    const text = buildAnnotationPrompt(state.annotations.slice());
    const title = nextDefaultConversationTitle(
      newConversationProviderId,
      Array.from(conversations.conversations.values(), (store) => store.data)
    );
    const conversationId = crypto.randomUUID();
    await conversations.createConversation({
      id: conversationId,
      projectId,
      taskId,
      provider: newConversationProviderId,
      title,
      autoApprove: autoApproveDefaults.getDefault(newConversationProviderId),
      initialPrompt: text,
    });
    taskView.tabGroupManager.openConversation(conversationId);
    taskView.setFocusedRegion('main');
  };

  const send = async () => {
    if (count === 0 || isSending) return;
    setIsSending(true);
    try {
      if (hasConversations) {
        await sendToExisting();
        if (targetId) {
          taskView.tabGroupManager.openConversation(targetId);
          taskView.setFocusedRegion('main');
        }
      } else {
        await sendToNewConversation();
      }
      onSent();
    } catch (error) {
      toast({
        title: 'Failed to send annotations to agent',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  if (count === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 animate-in items-center gap-1 rounded-xl bg-background-quaternary py-1.5 pr-1.5 pl-3.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.1),0_12px_32px_rgba(0,0,0,0.08)] duration-200 fade-in-0 slide-in-from-bottom-2">
      <span className="text-sm font-medium whitespace-nowrap tabular-nums">
        {count} {count === 1 ? 'annotation' : 'annotations'}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-foreground-muted"
              aria-label="Clear annotations"
              onClick={onClearAll}
            >
              <X className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent>Clear annotations</TooltipContent>
      </Tooltip>
      <div className="mx-1 h-4 w-px shrink-0 bg-border" />
      {hasConversations && (
        <Select value={targetId ?? undefined} onValueChange={(next) => setSelectedId(next)}>
          <SelectTrigger
            size="sm"
            className="max-w-52 border-0 bg-transparent shadow-none hover:bg-background-secondary dark:bg-transparent"
            aria-label="Agent conversation"
          >
            {targetOption ? (
              <ConversationOptionLabel
                providerId={targetOption.providerId}
                title={targetOption.title}
              />
            ) : (
              <span className="text-foreground-muted">Select conversation</span>
            )}
          </SelectTrigger>
          <SelectContent className="min-w-max">
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                <ConversationOptionLabel providerId={option.providerId} title={option.title} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button type="button" size="sm" className="h-7 gap-1.5" disabled={!canSend} onClick={send}>
        <Send className="size-3.5" />
        {hasConversations ? 'Send to agent' : 'Send to new agent'}
      </Button>
    </div>
  );
});

function ConversationOptionLabel({
  providerId,
  title,
}: {
  providerId: AgentProviderId;
  title: string;
}) {
  const config = agentConfig[providerId];
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {config && (
        <AgentLogo
          logo={config.logo}
          logoDark={config.logoDark}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-3.5 shrink-0"
        />
      )}
      <span className="truncate">{formatConversationTitleForDisplay(providerId, title)}</span>
    </span>
  );
}
