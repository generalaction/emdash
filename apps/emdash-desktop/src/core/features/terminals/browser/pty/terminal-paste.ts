import type { Terminal } from '@xterm/xterm';
import {
  clipboardDataMayContainImage,
  extractClipboardImageFiles,
  isUnstableDropPath,
} from '@core/features/terminals/api/browser/pty/terminal-image-paths';

/**
 * Pastes larger than this are rejected whole. Remote Wire streams close on frames over 16 MiB,
 * and JSON escaping can double the tabs and line breaks left in pasted text.
 */
export const MAX_TERMINAL_PASTE_BYTES = 4 * 1024 * 1024;

const CONTROL_PICTURES = 0x2400;
const ESCAPE_PICTURE = '␛';
const DELETE_PICTURE = '␡';
// C0 controls other than HT, LF and CR, DEL, and the C1 controls.
const PASTED_CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
const KEYSTROKE_CHARACTERS = /[\t\r\n]/;

/**
 * Makes control characters visible so pasted data cannot press keys, signal the foreground
 * process, or end its own bracketed-paste frame. C0 controls become their Unicode control
 * pictures (ESC is U+241B, as in upstream xterm.js) and DEL becomes U+2421. A C1 control is
 * the 8-bit form of ESC Fe (U+009B is CSI, ESC [), so it is shown as U+241B and its Fe byte.
 * Printable text, tabs and line breaks are unchanged; terminal.paste() then normalizes line
 * breaks and applies the negotiated framing.
 */
export function prepareTerminalPasteText(text: string): string {
  return text.replace(PASTED_CONTROLS, (control) => {
    const code = control.charCodeAt(0);
    if (code < 0x20) return String.fromCharCode(CONTROL_PICTURES + code);
    if (code === 0x7f) return DELETE_PICTURE;
    return ESCAPE_PICTURE + String.fromCharCode(code - 0x40);
  });
}

/** The framing terminal.paste() applies: the destination's mode unless xterm ignores it. */
export function effectiveBracketedPaste(terminal: Terminal): boolean {
  return terminal.modes.bracketedPasteMode && terminal.options.ignoreBracketedPasteMode !== true;
}

/** Without bracketed paste, line breaks arrive as Enter and tabs as completion keys. */
export function pasteActsAsKeystrokes(text: string, bracketedPasteMode: boolean): boolean {
  return !bracketedPasteMode && KEYSTROKE_CHARACTERS.test(text);
}

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Resolves true once xterm has parsed all output written before the call, so terminal modes
 * reflect it; false if the signal aborts first. The write callback is xterm's own ordering
 * barrier, not a delay.
 */
export function whenOutputParsed(terminal: Terminal, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (parsed: boolean) => {
      signal.removeEventListener('abort', onAbort);
      resolve(parsed && !signal.aborted);
    };
    const onAbort = () => finish(false);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      terminal.write('', () => finish(true));
    } catch {
      finish(false);
    }
  });
}

/** Resolves with the value, or with `cancelled` as soon as the signal aborts. */
export function unlessAborted<T, C>(value: Promise<T>, signal: AbortSignal, cancelled: C) {
  if (signal.aborted) return Promise.resolve(cancelled);
  return new Promise<T | C>((resolve, reject) => {
    const onAbort = () => resolve(cancelled);
    signal.addEventListener('abort', onAbort, { once: true });
    value.then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/** What a paste commits; acquired when the gesture happens. */
export type TerminalPasteContent =
  | { kind: 'text'; text: string }
  | { kind: 'image-files'; files: File[] }
  | { kind: 'image-path'; path: string }
  | { kind: 'empty' }
  | { kind: 'cancelled' };

/**
 * The paste priority for a DOM paste payload: image files the clipboard references on disk,
 * then plain text, then image data. Text therefore wins over the HTML or bitmap renditions
 * that rich-text sources add alongside it. `native-image` marks an image the payload
 * advertises without exposing it as a file.
 */
export function readPasteEventContent(
  data: DataTransfer | null,
  pathForFile: (file: File) => string
): TerminalPasteContent | { kind: 'native-image' } {
  const images = extractClipboardImageFiles(data);
  const referenced = images.filter((file) => {
    const path = pathForFile(file);
    return path !== '' && !isUnstableDropPath(path);
  });
  if (referenced.length > 0) return { kind: 'image-files', files: referenced };
  const text = data?.getData('text/plain') ?? '';
  if (text) return { kind: 'text', text };
  if (images.length > 0) return { kind: 'image-files', files: images };
  if (clipboardDataMayContainImage(data)) return { kind: 'native-image' };
  return { kind: 'empty' };
}

/** A paste commit reports `false` when nothing was sent (cancelled, declined or rejected). */
export type PasteCommitResult = boolean | void;

type QueuedInput = { deliver: () => void } | { paste: () => Promise<boolean>; cancel: () => void };

/**
 * Delivers one terminal input lifetime's input in gesture order. Input goes straight through
 * while nothing is queued. A paste is queued as soon as its gesture happens; its content is
 * acquired then, and its commit (output parse, confirmation, upload, send) runs after
 * everything queued before it. Input sent meanwhile, typed keys included, waits behind it:
 * it is sent once the paste is, and discarded if the paste is not, since keys such as Enter
 * were typed to follow it. close() ends the lifetime: held input is discarded, and pastes that
 * have not reached their commit are cancelled through `onCancel`.
 */
export class TerminalInputQueue {
  private readonly queued: QueuedInput[] = [];
  private draining = false;
  private closed = false;

  constructor(private readonly onDiscard: (count: number) => void = () => {}) {}

  send(deliver: () => void): void {
    if (this.closed) return;
    if (!this.draining && this.queued.length === 0) {
      deliver();
      return;
    }
    this.queued.push({ deliver });
  }

  paste<T>(
    content: T | PromiseLike<T>,
    commit: (content: T) => PasteCommitResult | Promise<PasteCommitResult>,
    onError: (error: unknown) => void,
    onCancel: () => void = () => {}
  ): void {
    if (this.closed) return onCancel();
    const acquired = Promise.resolve(content);
    // Observe failures now; they are reported in order once earlier work finishes.
    acquired.catch(() => {});
    this.queued.push({
      cancel: onCancel,
      paste: async () => {
        try {
          const value = await acquired;
          if (this.closed) {
            onCancel();
            return false;
          }
          return (await commit(value)) !== false;
        } catch (error) {
          try {
            onError(error);
          } catch {}
          return false;
        }
      },
    });
    void this.drain();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.discard(this.queued.splice(0));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    let sent = true;
    let discarded = 0;
    try {
      while (this.queued.length > 0 && !this.closed) {
        const next = this.queued.shift()!;
        if ('paste' in next) {
          if (discarded > 0) this.onDiscard(discarded);
          discarded = 0;
          sent = await next.paste();
        } else if (!sent) {
          // Held behind a paste that was not sent: discarded up to the next paste.
          discarded++;
        } else {
          try {
            next.deliver();
          } catch {}
        }
      }
    } finally {
      this.draining = false;
      if (discarded > 0) this.onDiscard(discarded);
    }
  }

  private discard(entries: QueuedInput[]): void {
    let count = 0;
    for (const entry of entries) {
      if ('deliver' in entry) count++;
      else entry.cancel();
    }
    if (count > 0) this.onDiscard(count);
  }
}
