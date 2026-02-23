import { isRealTaskInput } from '../lib/branchNameGenerator';

/**
 * Captures the first "real" user message sent to a CLI agent.
 *
 * `feed(data)` accumulates keystrokes (stripping ANSI escapes). On Enter,
 * the buffer is snapshotted as a pending message.
 *
 * `confirmSubmit()` is called when PTY output shows a "busy" signal
 * (via activityClassifier), confirming the message was actually submitted.
 * Fires the one-shot `onCapture` callback if the message passes validation.
 */
export class TerminalInputBuffer {
  private buffer = '';
  private pendingMessage: string | null = null;
  private fired = false;
  private disposed = false;
  private inEscape = false;

  constructor(private readonly onCapture: (message: string) => void) {}

  feed(data: string): void {
    if (this.disposed || this.fired) return;

    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const code = char.charCodeAt(0);

      if (code === 0x1b) {
        this.inEscape = true;
        continue;
      }

      if (this.inEscape) {
        if (
          (code >= 0x40 && code <= 0x5a) || // A-Z
          (code >= 0x61 && code <= 0x7a) || // a-z
          char === '~' ||
          code === 0x07
        ) {
          this.inEscape = false;
        }
        continue;
      }

      if (char === '\r' || char === '\n') {
        const trimmed = this.buffer.trim();
        if (trimmed) {
          this.pendingMessage = this.pendingMessage ? this.pendingMessage + ' ' + trimmed : trimmed;
        }
        this.buffer = '';
      } else if (char === '\x7f' || char === '\b') {
        this.buffer = this.buffer.slice(0, -1);
      } else if (code >= 32) {
        this.buffer += char;
      }
    }
  }

  confirmSubmit(): void {
    if (this.fired || this.disposed) return;
    if (!this.pendingMessage) return;

    const message = this.pendingMessage.replace(/\s+/g, ' ').trim();
    this.pendingMessage = null;

    if (!message) return;

    if (!isRealTaskInput(message)) return;

    this.fired = true;
    this.onCapture(message);
  }

  dispose(): void {
    this.disposed = true;
    this.buffer = '';
    this.pendingMessage = null;
  }
}
