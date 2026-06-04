import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
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
  useBYOI: boolean;
  setUseBYOI: (value: boolean) => void;
  isWorkspaceProviderEnabled: boolean;
  includeIssueContextByDefault: boolean;
}

export function SectionTabsPanel({
  state,
  initialConversation,
  projectId,
  currentBranch,
  isUnborn,
  useBYOI,
  setUseBYOI,
  isWorkspaceProviderEnabled,
  includeIssueContextByDefault,
}: SectionTabsPanelProps) {
  const [sectionTab, setSectionTab] = useState<SectionTab>('conversation');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex w-full items-center justify-between gap-2">
        <ToggleGroup
          className="w-full shrink-0 gap-1 border-none bg-transparent"
          value={[sectionTab]}
          onValueChange={([v]) => {
            if (v) setSectionTab(v as SectionTab);
          }}
        >
          <ToggleGroupItem
            className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
            value="conversation"
          >
            Initial Conversation
          </ToggleGroupItem>
          <ToggleGroupItem
            className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
            value="workspace"
          >
            Workspace Settings
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
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
            useBYOI={useBYOI}
            setUseBYOI={setUseBYOI}
            isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
          />
        )}
      </div>
    </div>
  );
}
