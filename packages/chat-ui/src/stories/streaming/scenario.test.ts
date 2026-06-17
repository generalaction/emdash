/**
 * scenario.ts unit tests — runs in the Node Vitest project (no DOM required).
 *
 * Verifies:
 *  - chunkText: boundaries, whitespace preservation, size grouping, concatenation
 *  - streamMessage / streamThinking / streamTool: step ordering and counts
 *  - scenario / seedStep: composition helpers
 */

import { describe, expect, it } from 'vitest';
import {
  chunkText,
  scenario,
  seedStep,
  streamMessage,
  streamThinking,
  streamTool,
} from './scenario';

// ── chunkText ─────────────────────────────────────────────────────────────────

describe('chunkText — word mode (default)', () => {
  it('concatenation equals the original string', () => {
    const text = 'Hello, world!\nThis is a streaming test.';
    expect(chunkText(text).join('')).toBe(text);
  });

  it('size=1 produces alternating word/whitespace atoms', () => {
    expect(chunkText('hello world')).toEqual(['hello', ' ', 'world']);
  });

  it('size=2 groups pairs of atoms', () => {
    // atoms = ['hello', ' ', 'world', ' ', 'foo'] → groups of 2
    const chunks = chunkText('hello world foo', { size: 2 });
    expect(chunks.join('')).toBe('hello world foo');
    expect(chunks).toEqual(['hello ', 'world ', 'foo']);
  });

  it('single word produces one chunk', () => {
    expect(chunkText('hello')).toEqual(['hello']);
  });

  it('preserves leading/trailing whitespace', () => {
    const text = '  hello  ';
    expect(chunkText(text).join('')).toBe(text);
  });

  it('preserves internal newlines', () => {
    const text = 'line one\n\nline two';
    expect(chunkText(text).join('')).toBe(text);
  });

  it('empty string returns empty array', () => {
    expect(chunkText('')).toEqual([]);
  });
});

describe('chunkText — char mode', () => {
  it('each chunk is exactly one character', () => {
    const chunks = chunkText('abc', { mode: 'char' });
    expect(chunks).toEqual(['a', 'b', 'c']);
  });

  it('concatenation equals original', () => {
    const text = 'hello\nworld';
    expect(chunkText(text, { mode: 'char' }).join('')).toBe(text);
  });

  it('size=3 groups three characters per chunk', () => {
    expect(chunkText('abcdef', { mode: 'char', size: 3 })).toEqual(['abc', 'def']);
  });
});

describe('chunkText — line mode', () => {
  it('each line includes its trailing newline', () => {
    const chunks = chunkText('line1\nline2\nline3', { mode: 'line' });
    expect(chunks).toEqual(['line1\n', 'line2\n', 'line3']);
  });

  it('concatenation equals original', () => {
    const text = 'alpha\nbeta\ngamma\n';
    expect(chunkText(text, { mode: 'line' }).join('')).toBe(text);
  });
});

// ── streamMessage ─────────────────────────────────────────────────────────────

describe('streamMessage', () => {
  it('first step is a synchronous call (creates the row)', () => {
    const steps = streamMessage({ id: 'm1', text: 'hello world' });
    expect(steps[0].kind).toBe('call');
  });

  it('last two steps are wait then call (turn_done)', () => {
    const steps = streamMessage({ id: 'm1', text: 'hello world' });
    expect(steps[steps.length - 2].kind).toBe('wait');
    expect(steps[steps.length - 1].kind).toBe('call');
  });

  it('has no consecutive call steps (wait precedes every post-init call)', () => {
    const steps = streamMessage({ id: 'm1', text: 'hello world foo' });
    // Skip index 0 (the init call); from index 1 onward: wait,call,wait,call,...
    for (let i = 1; i < steps.length - 1; i += 2) {
      expect(steps[i].kind).toBe('wait');
      expect(steps[i + 1].kind).toBe('call');
    }
  });

  it('step count matches: 1 (init) + 2*chunks + 2 (final wait+done)', () => {
    const text = 'a b c'; // 5 atoms → 5 chunks at size=1
    const chunks = chunkText(text);
    const steps = streamMessage({ id: 'm1', text });
    expect(steps).toHaveLength(1 + 2 * chunks.length + 2);
  });

  it('finalize=false omits turn_done', () => {
    const stepsWithDone = streamMessage({ id: 'm1', text: 'hello', finalize: true });
    const stepsNoDone = streamMessage({ id: 'm1', text: 'hello', finalize: false });
    // No final wait+call pair
    expect(stepsNoDone).toHaveLength(stepsWithDone.length - 2);
  });

  it('respects custom chunkMs in wait steps', () => {
    const steps = streamMessage({ id: 'm1', text: 'hello world', chunkMs: 120 });
    const waits = steps.filter((s) => s.kind === 'wait') as Array<{ kind: 'wait'; ms: number }>;
    expect(waits.every((w) => w.ms === 120)).toBe(true);
  });
});

// ── streamThinking ────────────────────────────────────────────────────────────

describe('streamThinking', () => {
  it('first step is a synchronous call (creates the row)', () => {
    const steps = streamThinking({ id: 'th1', text: 'analyzing...' });
    expect(steps[0].kind).toBe('call');
  });

  it('last two steps are wait then call (thinking_done)', () => {
    const steps = streamThinking({ id: 'th1', text: 'analyzing...' });
    expect(steps[steps.length - 2].kind).toBe('wait');
    expect(steps[steps.length - 1].kind).toBe('call');
  });

  it('step count: 1 (init) + 2*chunks + 2 (final wait+done)', () => {
    const text = 'hello world';
    const chunks = chunkText(text, { mode: 'word', size: 2 });
    const steps = streamThinking({ id: 'th1', text });
    expect(steps).toHaveLength(1 + 2 * chunks.length + 2);
  });
});

// ── streamTool ────────────────────────────────────────────────────────────────

describe('streamTool', () => {
  it('first step is a synchronous call (tool_start)', () => {
    const steps = streamTool({ id: 't1', name: 'read_file', steps: [] });
    expect(steps[0].kind).toBe('call');
    expect(steps).toHaveLength(1);
  });

  it('each update adds a wait + call pair', () => {
    const steps = streamTool({
      id: 't1',
      name: 'read_file',
      steps: [
        { afterMs: 200, status: 'done' },
        { afterMs: 100, status: 'done' },
      ],
    });
    // 1 (start) + 2 (update 1) + 2 (update 2)
    expect(steps).toHaveLength(5);
    expect(steps[1].kind).toBe('wait');
    expect(steps[2].kind).toBe('call');
    expect(steps[3].kind).toBe('wait');
    expect(steps[4].kind).toBe('call');
  });
});

// ── scenario / seedStep ───────────────────────────────────────────────────────

describe('scenario', () => {
  it('flattens multiple step arrays into one', () => {
    const a = streamThinking({ id: 'th1', text: 'thinking' });
    const b = streamMessage({ id: 'm1', text: 'hello' });
    const combined = scenario(a, b);
    expect(combined).toHaveLength(a.length + b.length);
    expect(combined).toEqual([...a, ...b]);
  });

  it('works with a single array', () => {
    const steps = streamMessage({ id: 'm1', text: 'hi' });
    expect(scenario(steps)).toEqual(steps);
  });
});

describe('seedStep', () => {
  it('returns a seed step with the provided items', () => {
    const items = [{ kind: 'message' as const, id: 'u1', role: 'user' as const, text: 'hi' }];
    const step = seedStep(items);
    expect(step.kind).toBe('seed');
    if (step.kind === 'seed') {
      expect(step.items).toBe(items);
    }
  });
});
