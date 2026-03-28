import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import AgentLogo from '@renderer/components/agent-logo';
import ShortcutHint from '@renderer/components/ui/shortcut-hint';
import { TabBar } from '@renderer/components/ui/tab-bar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { ConversationStore } from '@renderer/core/stores/conversation-manager';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { agentConfig } from '@renderer/lib/agentConfig';

export const ConversationsTabs = observer(function ConversationsTabs({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const conversationMgr = asProvisioned(getTaskStore(projectId, taskId))?.conversations;
  const showCreateConversationModal = useShowModal('createConversationModal');

  if (!conversationMgr) return null;

  return (
    <TabBar<ConversationStore>
      tabs={conversationMgr.tabs}
      activeTabId={conversationMgr.activeTabId}
      getId={(s) => s.data.id}
      getLabel={(s) => s.data.title}
      onSelect={(id) => conversationMgr.setActiveTab(id)}
      onRemove={(id) => {
        conversationMgr.removeTab(id);
      }}
      onAdd={() =>
        showCreateConversationModal({
          projectId,
          taskId,
          onSuccess: ({ conversationId }) => conversationMgr.setActiveTab(conversationId),
        })
      }
      renderTabPrefix={(s) => {
        const config = agentConfig[s.data.providerId];
        if (!config?.logo) return null;
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
      onRename={(id, name) => void conversationMgr.renameConversation(id, name)}
      onReorder={(from, to) => conversationMgr.reorderTabs(from, to)}
      addButton={
        <Tooltip>
          <TooltipTrigger>
            <button className="size-10 justify-center items-center flex border-l hover:bg-background text-foreground-muted hover:text-foreground">
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
