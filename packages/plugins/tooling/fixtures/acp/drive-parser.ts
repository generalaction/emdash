import { readFileSync } from 'node:fs';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { EnrichHook } from '@emdash/core/acp';
import { AcpTranscriptParser } from '@emdash/core/acp';

export interface RecordedPrompt {
  kind: 'prompt';
  sessionId: string;
  content: Array<{ type: string; text?: string }>;
}

export interface RecordedSessionUpdate {
  kind: 'session_update';
  sessionId: string;
  update: unknown;
}

export interface RecordedPromptResult {
  kind: 'prompt_result';
  sessionId: string;
  stopReason: string | null | undefined;
}

export type RecordedEvent = RecordedPrompt | RecordedSessionUpdate | RecordedPromptResult;

export interface RecordedEntry {
  seq: number;
  ts: number;
  event: RecordedEvent | { kind: string };
}

export interface FixtureFile {
  meta: { sessionId: string; providerId: string };
  events: RecordedEntry[];
}

export interface DriveParserOptions {
  enrich?: EnrichHook;
}

export function loadFixture(url: URL): FixtureFile {
  return JSON.parse(readFileSync(url, 'utf8')) as FixtureFile;
}

export function driveParser(
  fixture: FixtureFile,
  options: DriveParserOptions = {}
): AcpTranscriptParser {
  const { meta, events } = fixture;
  const parser = new AcpTranscriptParser({
    conversationId: meta.sessionId,
    ...(options.enrich ? { enrich: options.enrich } : {}),
  });

  for (const entry of events) {
    const kind = (entry.event as { kind: string }).kind;

    switch (kind) {
      case 'prompt': {
        const ev = entry.event as RecordedPrompt;
        for (const block of ev.content) {
          if (block.type === 'text' && block.text) {
            parser.push({
              sessionUpdate: 'user_message_chunk',
              sessionId: ev.sessionId,
              messageId: undefined,
              content: { type: 'text', text: block.text },
            } as unknown as SessionUpdate);
          }
        }
        break;
      }
      case 'session_update': {
        const ev = entry.event as RecordedSessionUpdate;
        parser.push(ev.update as SessionUpdate);
        break;
      }
      case 'prompt_result':
        parser.endTurn();
        break;
      default:
        break;
    }
  }

  return parser;
}
