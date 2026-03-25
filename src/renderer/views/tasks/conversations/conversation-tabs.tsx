import { observer } from 'mobx-react-lite';
import { makePtySessionId } from '@shared/ptySessionId';
import AgentLogo from '@renderer/components/agent-logo';
import { Button } from '@renderer/components/ui/button';
import { TabBar } from '@renderer/components/ui/tab-bar';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { ConversationStore } from '@renderer/core/stores/conversation-manager';
import { agentConfig } from '@renderer/lib/agentConfig';
import { getTaskStore, provisionedTask } from '../task-view-state';

export const ConversationsTabs = observer(function ConversationsTabs({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const conversationMgr = provisionedTask(getTaskStore(projectId, taskId))?.conversations;
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
        frontendPtyRegistry.unregister(makePtySessionId(projectId, taskId, id));
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
            className="h-3 w-3"
          />
        );
      }}
      onRename={(id, name) => void conversationMgr.renameConversation(id, name)}
      onReorder={(from, to) => conversationMgr.reorderTabs(from, to)}
      addButton={
        <Button variant="outline" size="xs" className="h-7 px-2.5 shrink-0">
          Create
        </Button>
      }
    />
  );
});
