import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentConfig } from '../lib/agentConfig';
import { type Agent } from '../types';
import AgentLogo from './AgentLogo';
import TaskContextBadges from './TaskContextBadges';
import { CreateChatModal } from './CreateChatModal';
import { useConversations } from '../contexts/ConversationsProvider';
import { useChatView } from '../contexts/ChatViewProvider';
import { useDependencies } from '../contexts/DependenciesProvider';

export function ChatTabs() {
  const {
    sortedConversations,
    conversations,
    activeConversationId,
    createConversation,
    switchConversation,
    closeConversation,
  } = useConversations();
  const {
    task,
    agent,
    autoApproveEnabled,
    showCreateChatModal,
    handleCreateNewChat,
    setShowCreateChatModal,
  } = useChatView();
  const { installedAgents } = useDependencies();

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);

  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const check = () => setTabsOverflow(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [conversations.length]);

  return (
    <>
      <CreateChatModal
        isOpen={showCreateChatModal}
        onClose={() => setShowCreateChatModal(false)}
        onCreateChat={(title, agent) => void createConversation(title, agent)}
        installedAgents={installedAgents}
      />

      <div className="flex items-center gap-2">
        <div
          ref={tabsContainerRef}
          className={cn(
            'flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            tabsOverflow &&
              '[mask-image:linear-gradient(to_right,black_calc(100%_-_16px),transparent)]'
          )}
        >
          {sortedConversations.map((conv, index) => {
            const isActive = conv.id === activeConversationId;
            const convAgent = conv.provider || agent;
            const config = agentConfig[convAgent as Agent];
            const agentName = config?.name || convAgent;

            const sameAgentCount = sortedConversations
              .slice(0, index + 1)
              .filter((c) => (c.provider || agent) === convAgent).length;
            const showNumber =
              sortedConversations.filter((c) => (c.provider || agent) === convAgent).length > 1;

            return (
              <button
                key={conv.id}
                onClick={() => switchConversation(conv.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors',
                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
                title={`${agentName}${showNumber ? ` (${sameAgentCount})` : ''}`}
              >
                {config?.logo && (
                  <AgentLogo
                    logo={config.logo}
                    alt={config.alt}
                    isSvg={config.isSvg}
                    invertInDark={config.invertInDark}
                    className="h-3.5 w-3.5 flex-shrink-0"
                  />
                )}
                <span className="max-w-[10rem] truncate">
                  {agentName}
                  {showNumber && <span className="ml-1 opacity-60">{sameAgentCount}</span>}
                </span>
                {conversations.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeConversation(conv.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        void closeConversation(conv.id);
                      }
                    }}
                    className="ml-1 rounded hover:bg-background/20"
                    title="Close chat"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={handleCreateNewChat}
          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border bg-muted transition-colors hover:bg-muted/80"
          title="New Chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          {(task.metadata?.linearIssue ||
            task.metadata?.githubIssue ||
            task.metadata?.jiraIssue) && (
            <TaskContextBadges
              taskId={task.id}
              linearIssue={task.metadata?.linearIssue || null}
              githubIssue={task.metadata?.githubIssue || null}
              jiraIssue={task.metadata?.jiraIssue || null}
            />
          )}
          {autoApproveEnabled && (
            <span
              className="inline-flex h-7 select-none items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-xs font-medium text-foreground"
              title="Auto-approve enabled"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              Auto-approve
            </span>
          )}
        </div>
      </div>
    </>
  );
}
