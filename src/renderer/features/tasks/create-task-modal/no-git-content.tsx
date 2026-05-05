import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { TaskNameField } from './task-name-field';
import { type NoGitModeState } from './use-no-git-mode';

interface NoGitContentProps {
  state: NoGitModeState;
  initialConversation: InitialConversationState;
  connectionId?: string;
}

export function NoGitContent({ state, initialConversation, connectionId }: NoGitContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs text-foreground-muted">
        This project is not a git repository. Tasks will run directly in the project folder without
        a worktree.
      </p>
      <TaskNameField state={state} />
      <InitialConversationField state={initialConversation} connectionId={connectionId} />
    </div>
  );
}
