import type { Terminal } from '@xterm/xterm';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import { events, rpc } from '../ipc';

const MAX_BUFFER_BYTES = 1024 * 1024; // 1 MB rolling cap

/**
 * Frontend counterpart to the main-process Pty interface.
 *
 * Subscribes to the PTY data IPC channel immediately on construction (before
 * any TerminalPane mounts), so output is never lost between session start and
 * tab activation.  Data is routed to one of two destinations:
 *
 *  - No xterm attached  →  accumulated in an in-memory buffer (capped at 1 MB)
 *  - xterm attached     →  written directly to terminal.write()
 *
 * On tab activation, attach() drains the buffer synchronously before the
 * pool's WebGL repaint rAF fires, so the first visible frame already has
 * content.  On tab deactivation, detach() resumes buffering.
 *
 * Lifecycle: created once per conversation session in FrontendPtyRegistry,
 * survives React component unmounts (e.g. navigating away from a task), and
 * is disposed only when the conversation is explicitly deleted.
 */
class FrontendPty {
  private buffer = '';
  private terminal: Terminal | null = null;
  private _onFirstData: (() => void) | null = null;
  private offData: () => void;

  constructor(sessionId: string) {
    // Subscribe to live data FIRST so no future output is missed during the
    // async buffer fetch below.
    this.offData = events.on(
      ptyDataChannel,
      (data) => {
        if (typeof data !== 'string') return;
        if (this.terminal) {
          this.terminal.write(data);
          this._onFirstData?.();
          this._onFirstData = null;
        } else {
          this.buffer += data;
          if (this.buffer.length > MAX_BUFFER_BYTES) {
            this.buffer = this.buffer.slice(-MAX_BUFFER_BYTES);
          }
        }
      },
      sessionId
    );
  }

  /**
   * Prepend historical output (from the main-process ring buffer) so it
   * appears before any live data that arrived during the async fetch.
   */
  prependBuffer(historical: string): void {
    this.buffer = historical + this.buffer;
  }

  /**
   * Wire a leased xterm Terminal to this session.
   *
   * Drains any buffered output to the terminal synchronously so it is present
   * before the pool's requestAnimationFrame WebGL repaint fires.
   *
   * @param terminal   The xterm Terminal returned by TerminalPool.lease().
   * @param onFirstData  Optional callback fired once on the first data write
   *                     after attach (or immediately if buffer was non-empty).
   *                     Used by useTerminal to set ptyStartedRef.
   */
  attach(terminal: Terminal, onFirstData?: () => void): void {
    this.terminal = terminal;
    this._onFirstData = onFirstData ?? null;
    if (this.buffer) {
      terminal.write(this.buffer);
      this.buffer = '';
      this._onFirstData?.();
      this._onFirstData = null;
    }
  }

  /**
   * Detach the xterm Terminal (tab deactivated / TerminalPane unmounting).
   * Future PTY output resumes buffering until the next attach().
   */
  detach(): void {
    this.terminal = null;
    this._onFirstData = null;
  }

  /**
   * Permanently dispose this session (conversation deleted).
   * Unsubscribes from the IPC data channel and clears the buffer.
   */
  dispose(): void {
    this.offData();
    this.terminal = null;
    this.buffer = '';
  }
}

/**
 * Module-level registry of FrontendPty instances, one per live conversation
 * session.  Lives outside React's lifecycle so buffers persist across
 * component unmounts (e.g. navigating away from a task and back).
 */
class FrontendPtyRegistry {
  private ptys = new Map<string, FrontendPty>();

  /**
   * Create and register a new FrontendPty for the given session.  No-op if
   * one already exists (idempotent — safe to call on every ConversationsPanel
   * mount, not just the first).
   *
   * On first registration, fetches any historical output accumulated in the
   * main-process ring buffer (for PTYs that started before the renderer
   * subscribed, e.g. setup scripts at app startup) and prepends it to the
   * FrontendPty's buffer.
   */
  register(sessionId: string): void {
    if (!this.ptys.has(sessionId)) {
      const pty = new FrontendPty(sessionId);
      this.ptys.set(sessionId, pty);
      // Fetch historical output outside the constructor to satisfy the
      // no-async-in-constructor lint rule. The FrontendPty has already
      // subscribed to live data above, so no output is lost during this fetch.
      rpc.pty.getBuffer(sessionId).then((result) => {
        if (result.success && result.data.buffer) {
          pty.prependBuffer(result.data.buffer);
        }
      });
    }
  }

  /** Return the FrontendPty for the given session, or undefined for sessions
   *  that were not registered (e.g. standalone task terminals). */
  get(sessionId: string): FrontendPty | undefined {
    return this.ptys.get(sessionId);
  }

  /** Dispose and remove the FrontendPty.  Called when a conversation is
   *  deleted. */
  unregister(sessionId: string): void {
    this.ptys.get(sessionId)?.dispose();
    this.ptys.delete(sessionId);
  }
}

export const frontendPtyRegistry = new FrontendPtyRegistry();
