const SKIP_PATTERNS = [
  /^\//,
  /^y(es)?$/i,
  /^n(o)?$/i,
  /^ok$/i,
  /^q(uit)?$/i,
  /^exit$/i,
  /^help$/i,
  /^\d+$/,
];

const HAS_ALPHA = /[A-Za-z]/;
const MIN_MESSAGE_LENGTH = 2;

export function isRealAgentPrompt(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length < MIN_MESSAGE_LENGTH) return false;
  if (!HAS_ALPHA.test(trimmed)) return false;
  return !SKIP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export class PtyInputSubmissionTracker {
  private readonly buffers = new Map<string, string>();

  feed(sessionId: string, data: string): boolean {
    let buffer = this.buffers.get(sessionId) ?? '';
    let submittedRealPrompt = false;

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

    if (buffer) {
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
