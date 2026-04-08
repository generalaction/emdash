import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import AgentLogo from '@renderer/components/agent-logo';
import { AgentStatusIndicator } from '@renderer/components/agent-status-indicator';
import ShortcutHint from '@renderer/components/ui/shortcut-hint';
import { TabBar } from '@renderer/components/ui/tab-bar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { ConversationStore } from '@renderer/core/stores/conversation-manager';
import { agentConfig } from '@renderer/lib/agentConfig';
import { useProvisionedTask } from '../task-view-context';

export const ConversationsTabs = observer(function ConversationsTabs({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const provisioned = useProvisionedTask();
  const conversationMgr = provisioned.conversations;
  const conversationTabs = provisioned.taskView.conversationTabs;
  const showCreateConversationModal = useShowModal('createConversationModal');

  return (
    <TabBar<ConversationStore>
      tabs={conversationTabs.tabs}
      activeTabId={conversationTabs.activeTabId}
      getId={(s) => s.data.id}
      getLabel={(s) => s.data.title}
      onSelect={(id) => conversationTabs.setActiveTab(id)}
      onRemove={(id) => {
        conversationTabs.removeTab(id);
      }}
      renderTabPrefix={(s) => {
        const config = agentConfig[s.data.providerId];
        return (
          <span className="flex items-center gap-1">
            <AgentLogo
              logo={config.logo}
              alt={config.alt}
              isSvg={config.isSvg}
              invertInDark={config.invertInDark}
              className="size-4"
            />
            <AgentStatusIndicator status={s.indicatorStatus} />
          </span>
        );
      }}
      onRename={(id, name) => void conversationMgr.renameConversation(id, name)}
      onReorder={(from, to) => conversationTabs.reorderTabs(from, to)}
      actions={
        <Tooltip>
          <TooltipTrigger>
            <button
              className="size-10 justify-center items-center flex border-l hover:bg-background text-foreground-muted hover:text-foreground"
              onClick={() =>
                showCreateConversationModal({
                  projectId,
                  taskId,
                  onSuccess: ({ conversationId }) => conversationTabs.setActiveTab(conversationId),
                })
              }
            >
              <Plus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Create conversation
            <ShortcutHint settingsKey="newConversation" />
          </TooltipContent>
        </Tooltip>
      }
    />
  );
});
