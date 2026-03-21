import { buildCommentScopeKey, draftCommentsStore } from './DraftCommentsStore';
import { formatCommentsForAgent } from './formatCommentsForAgent';
import { buildPromptInjectionPayload } from './terminalInjection';
import { isSlashCommandInput } from './slashCommand';
import { classifyActivity } from './activityClassifier';
import type { Agent } from '../types';

export interface PreparedPromptSubmission {
  text: string;
  isSlashCommand: boolean;
  commentScopeKey: string | null;
}

export function preparePromptSubmission(args: {
  prompt: string;
  taskId: string;
  taskPath?: string | null;
}): PreparedPromptSubmission {
  const prompt = args.prompt.trim();
  if (!prompt) {
    return {
      text: '',
      isSlashCommand: false,
      commentScopeKey: null,
    };
  }

  const isSlashCommand = isSlashCommandInput(prompt);
  if (isSlashCommand) {
    return {
      text: prompt,
      isSlashCommand: true,
      commentScopeKey: null,
    };
  }

  const scopeKey = buildCommentScopeKey(args.taskId, args.taskPath);
  const comments = draftCommentsStore.getAll(scopeKey);
  const pendingText = formatCommentsForAgent(comments, {
    includeIntro: false,
    leadingNewline: true,
  });

  return {
    text: pendingText ? `${prompt}${pendingText}` : prompt,
    isSlashCommand: false,
    commentScopeKey: pendingText ? scopeKey : null,
  };
}

export function consumePromptComments(commentScopeKey: string | null, injected: boolean) {
  if (!injected || !commentScopeKey) return;
  draftCommentsStore.consumeAll(commentScopeKey);
}

export async function injectPromptViaPty(args: {
  ptyId: string;
  agent: Agent;
  text: string;
}): Promise<boolean> {
  const trimmed = args.text.trim();
  if (!trimmed) return false;

  return await new Promise<boolean>((resolve) => {
    let sent = false;
    let finished = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let eagerTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    let offData: (() => void) | undefined;
    let offStarted: (() => void) | undefined;

    const cleanup = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (eagerTimer) {
        clearTimeout(eagerTimer);
        eagerTimer = null;
      }
      if (hardTimer) {
        clearTimeout(hardTimer);
        hardTimer = null;
      }
      offData?.();
      offStarted?.();
    };

    const finish = (didInject: boolean) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(didInject);
    };

    const send = () => {
      if (sent) return;
      sent = true;

      try {
        const pty = window.electronAPI?.ptyInput;
        if (!pty) {
          finish(false);
          return;
        }

        const { payload, submitDelayMs } = buildPromptInjectionPayload({
          agent: args.agent,
          text: trimmed,
        });
        pty({ id: args.ptyId, data: payload });
        setTimeout(() => {
          try {
            pty({ id: args.ptyId, data: '\r' });
          } catch {}
        }, submitDelayMs);
        finish(true);
      } catch {
        finish(false);
      }
    };

    offData = window.electronAPI?.onPtyData?.(args.ptyId, (chunk: string) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!sent) send();
      }, 1000);

      try {
        const signal = classifyActivity(args.agent, chunk);
        if (signal === 'idle' && !sent) {
          setTimeout(send, 200);
        }
      } catch {}
    });

    offStarted = window.electronAPI?.onPtyStarted?.((info: { id: string }) => {
      if (info?.id !== args.ptyId) return;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!sent) send();
      }, 1500);
    });

    eagerTimer = setTimeout(() => {
      if (!sent) send();
    }, 300);

    hardTimer = setTimeout(() => {
      if (!sent) send();
    }, 5000);
  });
}
