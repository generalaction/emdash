import { isRealTaskLikeInput } from '@shared/pty-input-filters';

export function isRealAgentPrompt(message: string): boolean {
  return isRealTaskLikeInput(message);
}

export class PtyInputSubmissionTracker {
  private readonly buffers = new Map<string, string>();

  feed(sessionId: string, data: string): boolean {
    let buffer = this.buffers.get(sessionId) ?? '';
    let submittedRealPrompt = false;

    // This lightweight tracker does not decode ANSI escape sequences; it only needs
    // enough text state to distinguish slash commands from real submitted prompts.
    for (const ch of data) {
      if (ch === '\r') {
        submittedRealPrompt ||= isRealAgentPrompt(buffer);
        buffer = '';
        continue;
      }

      if (ch === '\n') {
        buffer += ch;
        continue;
      }

      if (ch === '\x7f' || ch === '\b') {
        buffer = buffer.slice(0, -1);
        continue;
      }

      if (ch === '\x15') {
        buffer = '';
        continue;
      }

      if (ch.charCodeAt(0) >= 32) {
        buffer += ch;
      }
    }

    if (buffer.trim()) {
      this.buffers.set(sessionId, buffer);
    } else {
      this.buffers.delete(sessionId);
    }

    return submittedRealPrompt;
  }

  clear(sessionId: string): void {
    this.buffers.delete(sessionId);
  }
}
