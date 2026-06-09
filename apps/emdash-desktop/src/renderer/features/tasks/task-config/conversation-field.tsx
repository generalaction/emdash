import { InitialConversationField } from '@renderer/features/tasks/conversations/initial-conversation-section';
import { useTaskState } from './task-state-context';

interface ConversationFieldProps {
  placeholder?: string;
  textareaClassName?: string;
  onPromptBlur?: () => void;
}

export function ConversationField({
  placeholder,
  textareaClassName,
  onPromptBlur,
}: ConversationFieldProps) {
  const { initialConversation, linkedIssue, includeIssueContextByDefault } = useTaskState();

  return (
    <InitialConversationField
      state={initialConversation}
      linkedIssue={linkedIssue}
      includeIssueContextByDefault={includeIssueContextByDefault}
      placeholder={placeholder}
      textareaClassName={textareaClassName}
      onPromptBlur={onPromptBlur}
    />
  );
}
