/**
 * Fixture-driven snapshot tests for AcpTranscriptParser.
 *
 * Replays each recorded ACP session transcript through the parser and
 * snapshots all four output slices: transcript, config, usage, and title.
 * No manual assertions — the snapshots are the sole validation artifact.
 *
 * Clock is frozen so that startedAt/durationMs values in thinking rows are
 * deterministic across runs.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpTranscriptParser } from './parser';

// ── Narrow fixture types ──────────────────────────────────────────────────────

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

interface FixtureFile {
  meta: { sessionId: string; providerId: string };
  events: RecordedEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadFixture(filename: string): FixtureFile {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), 'utf8')
  ) as FixtureFile;
}

function driveParser(fixture: FixtureFile): AcpTranscriptParser {
  const { meta, events } = fixture;
  const parser = new AcpTranscriptParser({ conversationId: meta.sessionId });

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

// ── Clock control ─────────────────────────────────────────────────────────────

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

// ── Snapshot tests ────────────────────────────────────────────────────────────

describe('AcpTranscriptParser – fixture snapshots', () => {
  it('claude – transcript', () => {
    const parser = driveParser(loadFixture('acp-claude.json'));
    expect(parser.snapshot).toMatchSnapshot();
  });

  it('claude – config', () => {
    const parser = driveParser(loadFixture('acp-claude.json'));
    expect(parser.config).toMatchSnapshot();
  });

  it('claude – usage', () => {
    const parser = driveParser(loadFixture('acp-claude.json'));
    expect(parser.usage).toMatchSnapshot();
  });

  it('claude – title', () => {
    const parser = driveParser(loadFixture('acp-claude.json'));
    expect(parser.title).toMatchSnapshot();
  });

  it('codex – transcript', () => {
    const parser = driveParser(loadFixture('acp-codex.json'));
    expect(parser.snapshot).toMatchSnapshot();
  });

  it('codex – config', () => {
    const parser = driveParser(loadFixture('acp-codex.json'));
    expect(parser.config).toMatchSnapshot();
  });

  it('codex – usage', () => {
    const parser = driveParser(loadFixture('acp-codex.json'));
    expect(parser.usage).toMatchSnapshot();
  });

  it('codex – title', () => {
    const parser = driveParser(loadFixture('acp-codex.json'));
    expect(parser.title).toMatchSnapshot();
  });
});
