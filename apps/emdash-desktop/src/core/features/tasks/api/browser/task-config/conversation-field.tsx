import { InitialConversationField } from '@core/features/tasks/api/browser/task-config/initial-conversation-section';
import { useTaskState } from '@core/features/tasks/api/browser/task-config/task-state-context';

interface ConversationFieldProps {
  placeholder?: string;
  textareaClassName?: string;
  onPromptBlur?: () => void;
  showAutoApproveToggle?: boolean;
  requirePromptDelivery?: boolean;
}

export function ConversationField({
  placeholder,
  textareaClassName,
  onPromptBlur,
  requirePromptDelivery,
  showAutoApproveToggle,
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
      requirePromptDelivery={requirePromptDelivery}
      showAutoApproveToggle={showAutoApproveToggle}
    />
  );
}
