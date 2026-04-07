/**
 * One-shot capture of the user's first "real" terminal message.
 *
 * Accumulates keystrokes, strips ANSI escapes, handles backspace,
 * and fires the `onCapture` callback once when a confirmed submit
 * passes validation. After firing, the buffer disables itself.
 */

import { isSlashCommandInput } from '../lib/slashCommand';
import { stripAnsi } from '@shared/text/stripAnsi';

/** Strings that look like non-task-related input (confirmations, menu picks, etc.) */
const SKIP_PATTERNS = [
  /^y(es)?$/i, // confirmations
  /^n(o)?$/i,
  /^ok$/i,
  /^q(uit)?$/i,
  /^exit$/i,
  /^help$/i,
  /^\d+$/, // bare numbers (menu selections)
];

const MIN_MESSAGE_LENGTH = 10;

/** Returns true if the message looks like a real task description. */
function isRealTaskInput(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length < MIN_MESSAGE_LENGTH) return false;
  if (isSlashCommandInput(trimmed)) return false;
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

  private processInputCharacter(ch: string): void {
    if (ch === '\r' || ch === '\n') {
      // Enter pressed — snapshot the buffer as a pending message
      if (this.buffer.trim()) {
        this.pendingMessage = this.buffer.trim();
      }
      this.buffer = '';
      return;
    }

    if (ch === '\x7f' || ch === '\b') {
      // Backspace
      this.buffer = this.buffer.slice(0, -1);
      return;
    }

    if (ch.charCodeAt(0) >= 32) {
      // Printable character
      this.buffer += ch;
    }
  }

  /** Feed raw terminal input data (keystrokes). */
  feed(data: string): void {
    if (this.captured) return;

    const clean = stripAnsi(data, { includePrivateCsiParams: true, stripOscSt: true });
    for (const ch of clean) {
      this.processInputCharacter(ch);
    }
  }

  /**
   * Called when PTY output indicates the agent is "busy" (processing).
   * If we have a pending message that passes validation, fire the callback.
   */
  confirmSubmit(): void {
    if (this.captured || !this.pendingMessage) return;

    if (!isRealTaskInput(this.pendingMessage)) {
      // Not a real task input — discard and keep listening
      this.pendingMessage = null;
      return;
    }

    this.captured = true;
    const message = this.pendingMessage;
    this.pendingMessage = null;
    this.buffer = '';
    this.onCapture(message);
  }

  /** Whether the buffer has already fired its callback. */
  get isComplete(): boolean {
    return this.captured;
  }
}
