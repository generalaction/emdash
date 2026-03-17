/**
 * One-shot capture of the user's first "real" terminal message.
 *
 * Accumulates keystrokes, strips ANSI escapes, handles backspace,
 * and fires the `onCapture` callback once when a confirmed submit
 * passes validation. After firing, the buffer disables itself.
 */

/** Strings that look like non-task-related input (confirmations, slash commands, etc.) */
const SKIP_PATTERNS = [
  /^\//, // slash commands
  /^y(es)?$/i, // confirmations
  /^n(o)?$/i,
  /^ok$/i,
  /^q(uit)?$/i,
  /^exit$/i,
  /^help$/i,
  /^\d+$/, // bare numbers (menu selections)
];

const MIN_MESSAGE_LENGTH = 10;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

/** Returns true if the message looks like a real task description. */
function isRealTaskInput(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length < MIN_MESSAGE_LENGTH) return false;
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  return true;
}

export class TerminalInputBuffer {
  private buffer = '';
  private pendingMessage: string | null = null;
  private captured = false;
  private readonly onCapture: (message: string) => void;

  constructor(onCapture: (message: string) => void) {
    this.onCapture = onCapture;
  }

  /** Feed raw terminal input data (keystrokes). */
  feed(data: string): void {
    if (this.captured) return;

    const clean = stripAnsi(data);
    for (const ch of clean) {
      if (ch === '\r' || ch === '\n') {
        // Enter pressed — snapshot the buffer as a pending message
        if (this.buffer.trim()) {
          this.pendingMessage = this.buffer.trim();
        }
        this.buffer = '';
      } else if (ch === '\x7f' || ch === '\b') {
        // Backspace
        this.buffer = this.buffer.slice(0, -1);
      } else if (ch.charCodeAt(0) >= 32) {
        // Printable character
        this.buffer += ch;
      }
    }
  }

  /**
   * Called when PTY output indicates the agent is "busy" (processing).
   * If we have a pending message that passes validation, fire the callback.
   */
  confirmSubmit(): void {
    if (this.captured) return;
    if (!this.pendingMessage) return;

    if (isRealTaskInput(this.pendingMessage)) {
      this.captured = true;
      const message = this.pendingMessage;
      this.pendingMessage = null;
      this.buffer = '';
      this.onCapture(message);
    } else {
      // Not a real task input — discard and keep listening
      this.pendingMessage = null;
    }
  }

  /** Whether the buffer has already fired its callback. */
  get isComplete(): boolean {
    return this.captured;
  }
}
