/**
 * Fixture-driven snapshot test for AcpTranscriptParser.
 *
 * Replays the recorded Claude ACP session transcript through the parser and
 * snapshots the final TranscriptState. No manual assertions — the snapshot is
 * the sole validation artifact.
 *
 * Clock is frozen so that startedAt/durationMs values in thinking rows and
 * execute items are deterministic across runs.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpTranscriptParser } from './parser';
import { defaultTransform } from './decode';

// ── Narrow fixture types (mirrors recorder.ts shapes for the fields used here) ──

interface RecordedPrompt {
  kind: 'prompt';
  sessionId: string;
  content: Array<{ type: string; text?: string }>;
}
interface RecordedSessionUpdate {
  kind: 'session_update';
  sessionId: string;
  update: unknown;
}
interface RecordedPromptResult {
  kind: 'prompt_result';
  sessionId: string;
  stopReason: string | null | undefined;
}
type RecordedEvent = RecordedPrompt | RecordedSessionUpdate | RecordedPromptResult;
interface RecordedEntry {
  seq: number;
  ts: number;
  event: RecordedEvent | { kind: string };
}

// ── Fixture loading ──────────────────────────────────────────────────────────

interface FixtureFile {
  meta: { sessionId: string; providerId: string };
  events: RecordedEntry[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/claude-acp-transcript.json', import.meta.url), 'utf8')
) as FixtureFile;

// ── Clock control ─────────────────────────────────────────────────────────────

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function driveParser(events: RecordedEntry[], conversationId: string): AcpTranscriptParser {
  const parser = new AcpTranscriptParser({ conversationId, transform: defaultTransform });

  for (const entry of events) {
    const kind = (entry.event as { kind: string }).kind;

    switch (kind) {
      case 'prompt': {
        const ev = entry.event as RecordedPrompt;
        // Synthesize a user_message_chunk for each text block in the prompt.
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
      case 'prompt_result': {
        parser.endTurn();
        break;
      }
      default:
        break;
    }
  }

  return parser;
}

// ── Snapshot test ─────────────────────────────────────────────────────────────

describe('AcpTranscriptParser – Claude fixture', () => {
  it('matches snapshot', () => {
    const parser = driveParser(fixture.events, fixture.meta.sessionId);
    expect(parser.snapshot).toMatchSnapshot();
  });
});
