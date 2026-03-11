import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTaskComments } from './useLineComments';
import { pendingInjectionManager } from '../lib/PendingInjectionManager';
import { formatCommentsForAgent } from '../lib/formatCommentsForAgent';

export function useCommentInjection(taskId?: string, taskPath?: string | null) {
  const resolvedTaskId = taskId ?? '';
  const { comments, consumeAll } = useTaskComments(resolvedTaskId, taskPath);
  const consumeAllRef = useRef(consumeAll);
  const hasPendingRef = useRef(false);
  useLayoutEffect(() => {
    consumeAllRef.current = consumeAll;
  });

  useEffect(() => {
    if (!resolvedTaskId || comments.length === 0) {
      if (hasPendingRef.current) {
        pendingInjectionManager.clear();
        hasPendingRef.current = false;
      }
      return () => {
        if (hasPendingRef.current) {
          pendingInjectionManager.clear();
          hasPendingRef.current = false;
        }
      };
    }

    const formatted = formatCommentsForAgent(comments, {
      includeIntro: false,
      leadingNewline: true,
    });

    if (formatted) {
      pendingInjectionManager.setPending(formatted);
      hasPendingRef.current = true;
    } else if (hasPendingRef.current) {
      pendingInjectionManager.clear();
      hasPendingRef.current = false;
    }

    return () => {
      if (hasPendingRef.current) {
        pendingInjectionManager.clear();
        hasPendingRef.current = false;
      }
    };
  }, [comments, resolvedTaskId]);

  useEffect(() => {
    if (!resolvedTaskId) return;
    return pendingInjectionManager.onInjectionUsed(() => {
      consumeAllRef.current();
      hasPendingRef.current = false;
    });
  }, [resolvedTaskId]);
}
