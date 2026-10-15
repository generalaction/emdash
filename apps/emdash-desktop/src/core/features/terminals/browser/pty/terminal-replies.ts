import type { IDisposable, Terminal } from '@xterm/xterm';

/**
 * The xterm release whose reply sites the hooks below were checked against (InputHandler and
 * CoreBrowserTerminal). The app pins this version; a test fails when it changes, so an upgrade
 * re-reviews the hook list instead of silently holding new replies as typed input.
 */
export const REVIEWED_XTERM_VERSION = '6.0.0';

export interface TerminalReplyClassifier extends IDisposable {
  /** Whether input from onData is xterm answering the terminal, not the user typing. */
  isReply(data: string): boolean;
}

/**
 * Tells xterm's protocol replies apart from user input in onData, by origin. xterm answers
 * queries in the output while it parses that output, so parser hooks on exactly the queries
 * xterm 6 answers (device attributes, status and cursor reports, DECRQSS, window and colour
 * reports) mark the reply that follows. DECRQM is answered in usePty itself. Parser hooks run
 * inside xterm's synchronous parse, so the mark is cleared in a microtask once that parse
 * returns, before any later input event. Physical keys fire onKey just before their onData and
 * are never replies, even when they look like one (Ctrl+F3 sends CSI 1;5R). Focus reports
 * (mode 1004) follow focus changes rather than output, and no key produces them.
 */
export function createTerminalReplyClassifier(terminal: Terminal): TerminalReplyClassifier {
  let parsingQuery = false;
  let keyPressed = false;

  const markQuery = () => {
    if (!parsingQuery) {
      parsingQuery = true;
      queueMicrotask(() => {
        parsingQuery = false;
      });
    }
    // Not handled here: xterm's own handler answers the query.
    return false;
  };

  const { parser } = terminal;
  const disposables: IDisposable[] = [
    parser.registerCsiHandler({ final: 'c' }, markQuery), // DA1
    parser.registerCsiHandler({ prefix: '>', final: 'c' }, markQuery), // DA2
    parser.registerCsiHandler({ final: 'n' }, markQuery), // DSR, CPR
    parser.registerCsiHandler({ prefix: '?', final: 'n' }, markQuery), // DECXCPR
    parser.registerCsiHandler({ final: 't' }, markQuery), // window reports
    parser.registerDcsHandler({ intermediates: '$', final: 'q' }, markQuery), // DECRQSS
    ...[4, 10, 11, 12].map((ident) => parser.registerOscHandler(ident, markQuery)), // colours
    terminal.onKey(() => {
      keyPressed = true;
      queueMicrotask(() => {
        keyPressed = false;
      });
    }),
  ];

  return {
    isReply(data) {
      const fromKey = keyPressed;
      keyPressed = false;
      if (fromKey) return false;
      if (parsingQuery) return true;
      return terminal.modes.sendFocusMode && (data === '\x1b[I' || data === '\x1b[O');
    },
    dispose() {
      for (const disposable of disposables) disposable.dispose();
    },
  };
}
