import type { SessionUpdate } from '@agentclientprotocol/sdk';

export interface RawAcpLogMeta {
  conversationId: string;
  providerId: string;
  acpSessionId: string;
  createdAt: string;
}

export interface RawAcpLogExportMeta extends RawAcpLogMeta {
  generatedAt: string;
}

export interface RawAcpSessionUpdateEvent {
  kind: 'session_update';
  sessionId: string;
  update: SessionUpdate;
}

export interface RawAcpPromptEvent {
  kind: 'prompt';
  sessionId: string;
  content: unknown;
}

export interface RawAcpPromptResultEvent {
  kind: 'prompt_result';
  sessionId: string;
  stopReason: string | null | undefined;
}

export interface RawAcpPermissionRequestEvent {
  kind: 'permission_request';
  sessionId: string;
  request: unknown;
}

export interface RawAcpPermissionResolvedEvent {
  kind: 'permission_resolved';
  sessionId: string;
  requestId: string;
  optionId: string;
}

export type RawAcpEvent =
  | RawAcpSessionUpdateEvent
  | RawAcpPromptEvent
  | RawAcpPromptResultEvent
  | RawAcpPermissionRequestEvent
  | RawAcpPermissionResolvedEvent;

export interface RawAcpLogEntry {
  seq: number;
  ts: number;
  event: RawAcpEvent;
}

const DEFAULT_MAX_ENTRIES = 50_000;

/**
 * Append-only, fixture-compatible log of raw ACP traffic observed by a session.
 * This records data at the runtime boundary before the reducer normalizes it.
 */
export class RawAcpLog {
  private seq = 0;
  private readonly entries: RawAcpLogEntry[] = [];

  constructor(
    private readonly meta: RawAcpLogMeta,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES
  ) {}

  setAcpSessionId(acpSessionId: string): void {
    this.meta.acpSessionId = acpSessionId;
  }

  record(event: RawAcpEvent): void {
    this.entries.push({ seq: this.seq++, ts: Date.now(), event });
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  snapshot(): { meta: RawAcpLogExportMeta; events: RawAcpLogEntry[] } {
    return {
      meta: {
        ...this.meta,
        generatedAt: new Date().toISOString(),
      },
      events: structuredClone(this.entries),
    };
  }

  exportJson(): string {
    return JSON.stringify(this.snapshot(), null, 2);
  }
}
