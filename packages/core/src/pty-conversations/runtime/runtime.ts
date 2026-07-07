import { ok, type Result } from '@emdash/shared';
import type { LiveLogServer } from '../../live/log';
import { LiveModelServer } from '../../live/model';
import type {
  PtyAgentError,
  PtyAgentStartInput,
  PtySessionList,
  PtySessionState,
} from '../api/schemas';
import { ptyErr } from '../errors';
import { ConversationSessionCell } from '../session/cell';
import type { PtyRuntimeDeps, PtyStartResult } from './types';

export class PtyConversationsRuntime {
  private readonly sessions = new LiveModelServer<PtySessionList>({});
  private readonly cells = new Map<string, ConversationSessionCell>();

  constructor(private readonly deps: PtyRuntimeDeps) {}

  startSession(input: PtyAgentStartInput): Promise<PtyStartResult> {
    const created = !this.cells.has(input.conversationId);
    const cell = this.getOrCreateCell(input.conversationId);
    return cell.ensureStarted(input).then((result) => {
      if (!result.success && created && !cell.hasState) {
        cell.dispose();
        this.cells.delete(input.conversationId);
        this.removeSession(input.conversationId);
      }
      return result;
    });
  }

  stopSession(conversationId: string): Result<void, PtyAgentError> {
    const cell = this.cells.get(conversationId);
    if (!cell?.hasState) return ptyErr.notFound(conversationId);
    return cell.stop();
  }

  disposeSession(conversationId: string): Result<void, PtyAgentError> {
    const cell = this.cells.get(conversationId);
    if (!cell) return ptyErr.notFound(conversationId);
    cell.dispose();
    this.cells.delete(conversationId);
    this.removeSession(conversationId);
    return ok(undefined);
  }

  sendInput(conversationId: string, data: string): Result<void, PtyAgentError> {
    const cell = this.cells.get(conversationId);
    if (!cell?.write(data)) return ptyErr.notFound(conversationId);
    return ok(undefined);
  }

  resize(conversationId: string, cols: number, rows: number): Result<void, PtyAgentError> {
    const cell = this.cells.get(conversationId);
    if (!cell) return ptyErr.notFound(conversationId);
    cell.resize(cols, rows);
    return ok(undefined);
  }

  sessionsLiveModel(): LiveModelServer<PtySessionList> {
    return this.sessions;
  }

  outputLog(conversationId: string): LiveLogServer | null {
    return this.cells.get(conversationId)?.output ?? null;
  }

  private getOrCreateCell(conversationId: string): ConversationSessionCell {
    let cell = this.cells.get(conversationId);
    if (cell) return cell;
    cell = new ConversationSessionCell({
      conversationId,
      deps: this.deps,
      outputMaxBufferBytes: this.deps.outputMaxBufferBytes,
      publish: (state) => this.publishSession(state),
    });
    this.cells.set(conversationId, cell);
    return cell;
  }

  private publishSession(state: PtySessionState): void {
    this.sessions.produce((draft) => {
      draft[state.conversationId] = state;
    });
  }

  private removeSession(conversationId: string): void {
    this.sessions.produce((draft) => {
      delete draft[conversationId];
    });
  }
}
