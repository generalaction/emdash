import { useState } from 'react';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';
import type { InitialConversationState } from '../conversations/initial-conversation-section';
import { InitialConversationField } from '../conversations/initial-conversation-section';
import type { CreateTaskState } from './use-create-task-state';
import { WorkspaceSettingsSection } from './workspace-settings-section';

type SectionTab = 'conversation' | 'workspace';

interface SectionTabsPanelProps {
  state: CreateTaskState;
  initialConversation: InitialConversationState;
  projectId?: string;
  currentBranch: string | null;
  isUnborn: boolean;
  isWorkspaceProviderEnabled: boolean;
  includeIssueContextByDefault: boolean;
}

export function SectionTabsPanel({
  state,
  initialConversation,
  projectId,
  currentBranch,
  isUnborn,
  isWorkspaceProviderEnabled,
  includeIssueContextByDefault,
}: SectionTabsPanelProps) {
  const [sectionTab, setSectionTab] = useState<SectionTab>('conversation');

  return (
    <div className="flex flex-col gap-2">
      <PanelTabs
        value={sectionTab}
        onChange={setSectionTab}
        tabs={[
          { value: 'conversation', label: 'Initial Conversation' },
          { value: 'workspace', label: 'Workspace Settings' },
        ]}
      />
      <div>
        {sectionTab === 'conversation' && (
          <InitialConversationField
            state={initialConversation}
            linkedIssue={
              state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined
            }
            includeIssueContextByDefault={includeIssueContextByDefault}
          />
        )}
        {sectionTab === 'workspace' && (
          <WorkspaceSettingsSection
            state={state}
            projectId={projectId}
            currentBranch={currentBranch}
            isUnborn={isUnborn}
            isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
          />
        )}
      </div>
    </div>
  );
}
