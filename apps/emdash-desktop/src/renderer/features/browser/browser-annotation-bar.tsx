import { ChevronDown, Send, Trash2 } from 'lucide-react';
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
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { agentConfig } from '@renderer/utils/agentConfig';
import {
  AGENT_PROVIDER_IDS,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import { buildAnnotationPrompt } from './browser-annotation-prompt';
import type { BrowserAnnotationState } from './browser-annotation-store';

type AnnotationSendTarget =
  | { kind: 'existing'; conversationId: string }
  | { kind: 'new'; providerId: AgentProviderId };

type TargetOption = {
  value: string;
  label: string;
  providerId: AgentProviderId;
  target: AnnotationSendTarget;
};

type TargetGroup = { value: string; label: string; items: TargetOption[] };

function targetValue(target: AnnotationSendTarget): string {
  return target.kind === 'existing' ? `conv:${target.conversationId}` : `new:${target.providerId}`;
}

export const BrowserAnnotationBar = observer(function BrowserAnnotationBar({
  state,
  onSent,
  onClearAll,
  onRemoveAnnotation,
}: {
  state: BrowserAnnotationState;
  onSent: () => void;
  onClearAll: () => void;
  onRemoveAnnotation: (token: number, epoch: number) => void;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const conversations = useConversations();
  const taskView = useWorkspaceViewModel();
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId: defaultNewProviderId, createDisabled } = useEffectiveProvider(connectionId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const [target, setTarget] = useState<AnnotationSendTarget | null>(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Match the tabbar: only conversations with an open tab are editable targets here.
  const openConversationOptions = new Map<
    string,
    {
      id: string;
      title: string;
      providerId: AgentProviderId;
    }
  >();
  for (const group of taskView.tabGroupManager.groups) {
    for (const tab of group.tabManager.resolvedTabs) {
      if (tab.kind !== 'conversation' || openConversationOptions.has(tab.conversationId)) continue;
      openConversationOptions.set(tab.conversationId, {
        id: tab.conversationId,
        title: tab.store.data.title,
        providerId: tab.store.data.providerId,
      });
    }
  }
  const options = Array.from(openConversationOptions.values());

  const dependencyResource = connectionId
    ? appState.dependencies.getRemote(connectionId)
    : appState.dependencies.local;
  const installedProviders = AGENT_PROVIDER_IDS.filter(
    (id) => dependencyResource.data?.[id]?.status === 'available'
  );

  const resolvedTarget: AnnotationSendTarget | null = (() => {
    if (target?.kind === 'existing' && options.some((o) => o.id === target.conversationId)) {
      return target;
    }
    if (target?.kind === 'new' && installedProviders.includes(target.providerId)) {
      return target;
    }
    if (options[0]) return { kind: 'existing', conversationId: options[0].id };
    if (defaultNewProviderId && !createDisabled) {
      return { kind: 'new', providerId: defaultNewProviderId };
    }
    return null;
  })();

  const conversationOptions: TargetOption[] = options.map((option) => ({
    value: `conv:${option.id}`,
    label: formatConversationTitleForDisplay(option.providerId, option.title),
    providerId: option.providerId,
    target: { kind: 'existing', conversationId: option.id },
  }));
  const providerOptions: TargetOption[] = installedProviders.map((providerId) => ({
    value: `new:${providerId}`,
    label: agentConfig[providerId]?.name ?? providerId,
    providerId,
    target: { kind: 'new', providerId },
  }));
  const targetGroups: TargetGroup[] = [
    ...(conversationOptions.length
      ? [{ value: 'conversations', label: 'Agents', items: conversationOptions }]
      : []),
    ...(providerOptions.length
      ? [{ value: 'providers', label: 'New agent', items: providerOptions }]
      : []),
  ];
  const selectedTargetOption = resolvedTarget
    ? [...conversationOptions, ...providerOptions].find(
        (option) => option.value === targetValue(resolvedTarget)
      )
    : undefined;

  const count = state.annotations.length;
  const canSend = count > 0 && !isSending && resolvedTarget !== null;

  const sendToExisting = async (conversationId: string) => {
    const session = conversations.sessions.get(conversationId);
    const conversation = conversations.conversations.get(conversationId);
    if (!session || !conversation) throw new Error('Conversation unavailable');

    // The target may be dehydrated (tab closed → PTY killed). Hydrating is
    // idempotent: the session supervisor ignores it when the PTY is running.
    await conversations.hydrateConversation(conversationId);

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
    taskView.tabGroupManager.openConversation(conversationId);
    taskView.setFocusedRegion('main');
  };

  const sendToNewConversation = async (providerId: AgentProviderId) => {
    const text = buildAnnotationPrompt(state.annotations.slice());
    const title = nextDefaultConversationTitle(
      providerId,
      Array.from(conversations.conversations.values(), (store) => store.data)
    );
    const conversationId = crypto.randomUUID();
    await conversations.createConversation({
      id: conversationId,
      projectId,
      taskId,
      provider: providerId,
      title,
      autoApprove: autoApproveDefaults.getDefault(providerId),
      initialPrompt: text,
    });
    taskView.tabGroupManager.openConversation(conversationId);
    taskView.setFocusedRegion('main');
  };

  const send = async () => {
    if (count === 0 || isSending || !resolvedTarget) return;
    setIsSending(true);
    try {
      if (resolvedTarget.kind === 'existing') {
        await sendToExisting(resolvedTarget.conversationId);
      } else {
        await sendToNewConversation(resolvedTarget.providerId);
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
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 animate-in items-center gap-1 rounded-xl bg-background-quaternary p-1.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.1),0_12px_32px_rgba(0,0,0,0.08)] duration-200 fade-in-0 slide-in-from-bottom-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-sm font-medium tabular-nums"
            />
          }
        >
          {count} {count === 1 ? 'annotation' : 'annotations'}
          <ChevronDown className="size-3.5 text-foreground-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-80 min-w-56">
          {state.annotations.map((annotation, index) => (
            <DropdownMenuItem
              key={`${annotation.epoch}:${annotation.token}`}
              className="gap-2"
              onClick={() => onRemoveAnnotation(annotation.token, annotation.epoch)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{annotation.comment}</span>
              <Trash2 className="size-3.5 shrink-0 text-foreground-muted" />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClearAll}>Clear all annotations</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="mx-1 h-4 w-px shrink-0 bg-border" />
      <Combobox
        items={targetGroups}
        value={selectedTargetOption ?? null}
        onValueChange={(item: TargetOption | null) => {
          if (item) setTarget(item.target);
          setTargetPickerOpen(false);
        }}
        open={targetPickerOpen}
        onOpenChange={setTargetPickerOpen}
        isItemEqualToValue={(a: TargetOption, b: TargetOption) => a.value === b.value}
        filter={(item: TargetOption, query) =>
          item.label.toLowerCase().includes(query.toLowerCase())
        }
        autoHighlight
      >
        <ComboboxTrigger
          aria-label="Send target"
          className="flex h-7 max-w-56 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm outline-none hover:bg-background-secondary"
        >
          {resolvedTarget ? (
            <SendTargetLabel target={resolvedTarget} conversations={options} />
          ) : (
            <span className="text-foreground-muted">No agent available</span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
        </ComboboxTrigger>
        <ComboboxContent className="min-w-64">
          <ComboboxInput showTrigger={false} placeholder="Search agents…" />
          <ComboboxList>
            {(group: TargetGroup) => (
              <ComboboxGroup key={group.value} items={group.items} className="py-1">
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(item: TargetOption) => (
                    <ComboboxItem key={item.value} value={item}>
                      <ProviderLabel providerId={item.providerId} label={item.label} />
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
          <ComboboxEmpty>No open agents or installed agents</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
      <Button type="button" size="sm" className="h-7 gap-1.5" disabled={!canSend} onClick={send}>
        <Send className="size-3.5" />
        {resolvedTarget?.kind === 'new' ? 'Send to new agent' : 'Send to agent'}
      </Button>
    </div>
  );
});

function SendTargetLabel({
  target,
  conversations,
}: {
  target: AnnotationSendTarget;
  conversations: Array<{ id: string; title: string; providerId: AgentProviderId }>;
}) {
  if (target.kind === 'existing') {
    const conversation = conversations.find((option) => option.id === target.conversationId);
    if (!conversation) return null;
    return (
      <ProviderLabel
        providerId={conversation.providerId}
        label={formatConversationTitleForDisplay(conversation.providerId, conversation.title)}
      />
    );
  }
  return (
    <ProviderLabel
      providerId={target.providerId}
      label={`New ${agentConfig[target.providerId]?.name ?? target.providerId}`}
    />
  );
}

function ProviderLabel({ providerId, label }: { providerId: AgentProviderId; label: string }) {
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
      <span className="truncate">{label}</span>
    </span>
  );
}
