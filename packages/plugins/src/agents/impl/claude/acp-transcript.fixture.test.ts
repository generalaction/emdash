/**
 * Fixture-driven snapshot test for AcpTranscriptParser – Claude.
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
import { driveParser } from '../../acp-fixture-driver';

// ── Fixture loading ──────────────────────────────────────────────────────────

interface FixtureFile {
  meta: { sessionId: string; providerId: string };
  events: Parameters<typeof driveParser>[0];
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/acp-transcript.json', import.meta.url), 'utf8')
) as FixtureFile;

// ── Clock control ─────────────────────────────────────────────────────────────

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

// ── Snapshot test ─────────────────────────────────────────────────────────────

describe('AcpTranscriptParser – Claude fixture', () => {
  it('matches snapshot', () => {
    const parser = driveParser(fixture.events, fixture.meta.sessionId);
    expect(parser.snapshot).toMatchSnapshot();
  });
});
