import { InitialConversationField } from '@renderer/features/tasks/conversations/initial-conversation-section';
import { useTaskState } from './task-state-context';

interface ConversationFieldProps {
  placeholder?: string;
  textareaClassName?: string;
  onPromptBlur?: () => void;
  showAutoApproveToggle?: boolean;
}

export function ConversationField({
  placeholder,
  textareaClassName,
  onPromptBlur,
  showAutoApproveToggle,
}: ConversationFieldProps) {
  const { initialConversation, linkedIssue, linkedIssues, includeIssueContextByDefault } =
    useTaskState();

  return (
    <InitialConversationField
      state={initialConversation}
      linkedIssue={linkedIssue}
      linkedIssues={linkedIssues}
      includeIssueContextByDefault={includeIssueContextByDefault}
      placeholder={placeholder}
      textareaClassName={textareaClassName}
      onPromptBlur={onPromptBlur}
      showAutoApproveToggle={showAutoApproveToggle}
    />
  );
}
