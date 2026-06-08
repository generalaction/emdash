import { useState } from 'react';
import type { InitialConversationState } from '@renderer/features/tasks/conversations/initial-conversation-section';
import { InitialConversationField } from '@renderer/features/tasks/conversations/initial-conversation-section';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { WorkspaceConfigState } from '@renderer/features/tasks/create-task-modal/use-workspace-config';
import { useTaskConfig } from './task-config-context';
import { WorkspaceSettingsSection } from './workspace-settings-section';

type SectionTab = 'conversation' | 'workspace';

interface TaskConfigPanelProps {
  workspaceConfig: WorkspaceConfigState;
  hasPR?: boolean;
  initialConversation: InitialConversationState;
  linkedIssue?: LinkedIssue;
  projectId?: string;
  isUnborn?: boolean;
  isWorkspaceProviderEnabled: boolean;
  includeIssueContextByDefault?: boolean;
  onPromptBlur?: () => void;
}

export function TaskConfigPanel({
  workspaceConfig,
  hasPR = false,
  initialConversation,
  linkedIssue,
  projectId,
  isUnborn = false,
  isWorkspaceProviderEnabled,
  includeIssueContextByDefault = false,
  onPromptBlur,
}: TaskConfigPanelProps) {
  const [sectionTab, setSectionTab] = useState<SectionTab>('conversation');
  const { conversationLabel } = useTaskConfig();

  return (
    <div className="flex flex-col gap-2">
      <PanelTabs
        value={sectionTab}
        onChange={setSectionTab}
        tabs={[
          { value: 'conversation', label: conversationLabel },
          { value: 'workspace', label: 'Workspace Settings' },
        ]}
      />
      <div>
        {sectionTab === 'conversation' && (
          <InitialConversationField
            state={initialConversation}
            linkedIssue={linkedIssue}
            includeIssueContextByDefault={includeIssueContextByDefault}
            onPromptBlur={onPromptBlur}
          />
        )}
        {sectionTab === 'workspace' && (
          <WorkspaceSettingsSection
            workspaceConfig={workspaceConfig}
            projectId={projectId}
            isUnborn={isUnborn}
            isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
            hasPR={hasPR}
          />
        )}
      </div>
    </div>
  );
}
