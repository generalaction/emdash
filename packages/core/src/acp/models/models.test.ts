import { readFileSync } from 'node:fs';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { AcpTranscriptParser } from '../reducer/parser';
import { agentStateSchema } from './agents';
import { sessionConfigStateSchema, sessionUsageSchema } from './config';
import { planStateSchema } from './plan';
import { transcriptTurnSchema } from './turns';

interface RecordedPrompt {
  kind: 'prompt';
  sessionId: string;
  content: Array<{ type: string; text?: string }>;
}

interface RecordedSessionUpdate {
  kind: 'session_update';
  update: unknown;
}

interface RecordedPromptResult {
  kind: 'prompt_result';
}

type RecordedEvent = RecordedPrompt | RecordedSessionUpdate | RecordedPromptResult;

interface RecordedEntry {
  event: RecordedEvent | { kind: string };
}

interface FixtureFile {
  meta: { sessionId: string };
  events: RecordedEntry[];
}

function loadFixture(filename: string): FixtureFile {
  return JSON.parse(
    readFileSync(new URL(`../reducer/fixtures/${filename}`, import.meta.url), 'utf8')
  ) as FixtureFile;
}

function driveParser(fixture: FixtureFile): AcpTranscriptParser {
  const parser = new AcpTranscriptParser({ conversationId: fixture.meta.sessionId });
  parser.beginReplay(0);

  for (const entry of fixture.events) {
    const kind = entry.event.kind;
    switch (kind) {
      case 'prompt': {
        const ev = entry.event as RecordedPrompt;
        for (const block of ev.content) {
          if (block.type !== 'text' || !block.text) continue;
          parser.push({
            sessionUpdate: 'user_message_chunk',
            sessionId: ev.sessionId,
            messageId: undefined,
            content: { type: 'text', text: block.text },
          } as unknown as SessionUpdate);
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

  parser.endReplay();
  return parser;
}

describe('ACP zod models', () => {
  it.each(['acp-claude.json', 'acp-codex.json'])(
    'validate parser output for %s',
    (fixtureName) => {
      const parser = driveParser(loadFixture(fixtureName));

      expect(() => transcriptTurnSchema.array().parse(parser.history)).not.toThrow();
      expect(() =>
        parser.activeTurn === null ? null : transcriptTurnSchema.parse(parser.activeTurn)
      ).not.toThrow();
      expect(() => sessionConfigStateSchema.parse(parser.config)).not.toThrow();
      expect(() =>
        parser.usage === null ? null : sessionUsageSchema.parse(parser.usage)
      ).not.toThrow();
      expect(() => agentStateSchema.array().parse(parser.agents)).not.toThrow();
      expect(() =>
        parser.plan === null ? null : planStateSchema.parse(parser.plan)
      ).not.toThrow();
    }
  );
});
