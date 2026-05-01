import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { type ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { TabBar } from '@renderer/lib/ui/tab-bar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { formatConversationTitleForDisplay } from './conversation-title-utils';

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
  const mountedProject = asMounted(getProjectStore(projectId));
  const connectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  return (
    <TabBar<ConversationStore>
      tabs={conversationTabs.tabs}
      activeTabId={conversationTabs.activeTabId}
      getId={(s) => s.data.id}
      getLabel={(s) => formatConversationTitleForDisplay(s.data.providerId, s.data.title)}
      onSelect={(id) => conversationTabs.setActiveTab(id)}
      onRemove={(id) => {
        conversationTabs.removeTab(id);
      }}
      renderTabPrefix={(s) => {
        const config = agentConfig[s.data.providerId];
        return (
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4"
          />
        );
      }}
      renderTabSuffix={(s) => <AgentStatusIndicator status={s.indicatorStatus} disableTooltip />}
      onRename={(id, name) => void conversationMgr.renameConversation(id, name)}
      onReorder={(from, to) => conversationTabs.reorderTabs(from, to)}
      actions={
        <Tooltip>
          <TooltipTrigger>
            <button
              className="size-10 justify-center items-center flex border-l hover:bg-background text-foreground-muted hover:text-foreground"
              onClick={() =>
                showCreateConversationModal({
                  connectionId,
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
