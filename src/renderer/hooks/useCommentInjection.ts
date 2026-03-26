import { useTaskComments } from './useLineComments';
import { formatCommentsForAgent } from '../lib/formatCommentsForAgent';
import { useInjectionSource } from './useInjectionSource';

const INJECTION_SOURCE = 'diff-comments';

const formatter = (comments: { filePath: string; lineNumber: number; content: string }[]) =>
  formatCommentsForAgent(comments, { includeIntro: false, leadingNewline: true });

export function useCommentInjection(taskId?: string, taskPath?: string | null) {
  const resolvedTaskId = taskId ?? '';
  const { comments, consumeAll } = useTaskComments(resolvedTaskId, taskPath);

  useInjectionSource(INJECTION_SOURCE, comments, formatter, consumeAll, !!resolvedTaskId);
}
