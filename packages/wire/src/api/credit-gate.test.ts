import { describe, expect, it } from 'vitest';
import { createCreditGate } from './credit-gate';

type Update = { sequence: number };

function createGate(
  overrides: {
    window?: number;
    stallMs?: number;
    pauseAt?: number;
    resumeAt?: number;
    maxPending?: number;
  } = {}
) {
  let time = 0;
  const sent: Update[] = [];
  const pressures: boolean[] = [];
  const overflows: number[] = [];

  const gate = createCreditGate<Update>({
    window: overrides.window ?? 100,
    stallMs: overrides.stallMs ?? 30_000,
    pauseAt: overrides.pauseAt ?? 256 * 1024,
    resumeAt: overrides.resumeAt ?? 128 * 1024,
    maxPending: overrides.maxPending ?? 1024 * 1024,
    now: () => time,
    send: (update) => sent.push(update),
    onPressure: (pressured) => pressures.push(pressured),
    onOverflow: () => overflows.push(time),
  });

  return {
    gate,
    sent,
    pressures,
    overflows,
    now: () => time,
    advance(milliseconds: number) {
      time += milliseconds;
    },
  };
}

const CHUNK = 16 * 1024;
const STEP_MS = 10;
const MIN_WINDOW = 64 * 1024;
const MAX_WINDOW = 4 * 1024 * 1024;

// A saturating producer behind a link: updates reach the client rttMs after
// they are sent, and the client credits at most bytesPerMs. Returns the gate
// window after every step.
function simulateLink({
  rttMs,
  bytesPerMs = Infinity,
  durationMs,
  reportEveryMs = STEP_MS,
}: {
  rttMs: number | ((elapsedMs: number) => number);
  bytesPerMs?: number;
  durationMs: number;
  /** The client reports this rarely, each time as two reports 1 ms apart (a batch the link delivered together). */
  reportEveryMs?: number;
}): number[] {
  const { gate, sent, advance, now } = createGate({
    window: MIN_WINDOW,
    stallMs: Infinity,
    pauseAt: Infinity,
    maxPending: Infinity,
  });
  const sentAt: number[] = [];
  const windows: number[] = [];
  let sequence = 0;
  let credited = 0;
  let readable = 0; // bytes the client has received and could credit

  function pump(): void {
    while (gate.pendingBytes < 1024 * 1024) {
      gate.offer({ sequence: sequence++ }, CHUNK);
    }
    while (sentAt.length < sent.length) sentAt.push(now());
  }

  pump();
  for (let elapsed = 0; elapsed < durationMs; elapsed += STEP_MS) {
    advance(STEP_MS);
    const rtt = typeof rttMs === 'number' ? rttMs : rttMs(elapsed);
    const arrived = sentAt.filter((at) => at <= now() - rtt).length * CHUNK;
    readable = Math.min(arrived, readable + bytesPerMs * STEP_MS);
    const target = readable;
    if (target > credited && (elapsed + STEP_MS) % reportEveryMs === 0) {
      if (reportEveryMs > STEP_MS) {
        gate.credit(credited + Math.floor((target - credited) / 2));
        advance(1);
      }
      credited = target;
      gate.credit(credited);
      pump();
    }
    windows.push(gate.window);
  }
  return windows;
}

describe('createCreditGate', () => {
  it('sends while the window allows and drains queued updates in order', () => {
    const { gate, sent } = createGate({ window: 100 });

    gate.offer({ sequence: 1 }, 60);
    gate.offer({ sequence: 2 }, 50);
    gate.offer({ sequence: 3 }, 10);

    expect(sent).toEqual([{ sequence: 1 }]);
    expect(gate.pendingBytes).toBe(60);

    gate.credit(60);

    expect(sent.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(gate.pendingBytes).toBe(0);
  });

  it('sends an oversized update when nothing is in flight, then queues until credit clears it', () => {
    const { gate, sent } = createGate({ window: 10 });

    gate.offer({ sequence: 1 }, 100);
    gate.offer({ sequence: 2 }, 5);

    expect(sent).toEqual([{ sequence: 1 }]);

    gate.credit(100);

    expect(sent.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  it('clamps credit to sent and ignores a credit below the last one', () => {
    const { gate } = createGate({ window: 50 });

    gate.offer({ sequence: 1 }, 20);
    gate.credit(15);
    gate.credit(10);
    expect(gate.consumed).toBe(15);

    gate.credit(500);
    expect(gate.consumed).toBe(20);
  });

  it('fires pressure once on the way up and once on the way down', () => {
    const { gate, pressures } = createGate({ window: 10, pauseAt: 200, resumeAt: 100 });

    gate.offer({ sequence: 1 }, 10);
    gate.offer({ sequence: 2 }, 100);
    gate.offer({ sequence: 3 }, 100);
    gate.offer({ sequence: 4 }, 50);

    expect(pressures).toEqual([true]);

    gate.credit(10);
    expect(pressures).toEqual([true]);

    gate.credit(110);
    expect(pressures).toEqual([true, false]);
    expect(gate.pendingBytes).toBe(50);
  });

  it('overflows when pending would exceed maxPending and clears the queue', () => {
    const { gate, sent, pressures, overflows } = createGate({
      window: 10,
      pauseAt: 50,
      resumeAt: 25,
      maxPending: 100,
    });

    gate.offer({ sequence: 1 }, 10);
    gate.offer({ sequence: 2 }, 90);
    gate.offer({ sequence: 3 }, 20);

    expect(overflows).toHaveLength(1);
    expect(pressures).toEqual([true, false]);
    expect(gate.pendingBytes).toBe(0);
    expect(sent).toEqual([{ sequence: 1 }]);
  });

  it('overflows after a stall with a fake clock and does not repeat immediately', () => {
    const { gate, sent, overflows, advance } = createGate({ window: 10, stallMs: 100 });

    gate.offer({ sequence: 1 }, 10);
    gate.offer({ sequence: 2 }, 20);
    advance(100);
    gate.check();

    expect(overflows).toHaveLength(1);
    expect(gate.pendingBytes).toBe(0);
    expect(sent).toEqual([{ sequence: 1 }]);

    gate.check();
    expect(overflows).toHaveLength(1);
  });

  it('dispose releases pressure and drops queued updates', () => {
    const { gate, sent, pressures } = createGate({ window: 10, pauseAt: 50, resumeAt: 25 });

    gate.offer({ sequence: 1 }, 10);
    gate.offer({ sequence: 2 }, 40);
    gate.offer({ sequence: 3 }, 20);
    expect(pressures).toEqual([true]);

    gate.dispose();
    expect(pressures).toEqual([true, false]);
    expect(gate.pendingBytes).toBe(0);

    gate.offer({ sequence: 4 }, 10);
    gate.credit(100);
    expect(sent).toEqual([{ sequence: 1 }]);
    expect(gate.consumed).toBe(0);
  });

  it('grows past 1 MiB within 10 round trips on a fast link and respects maxWindow', () => {
    const windows = simulateLink({ rttMs: 300, durationMs: 3_000 });

    expect(windows[windows.length - 1]).toBeGreaterThan(1024 * 1024);
    expect(Math.max(...windows)).toBeLessThanOrEqual(MAX_WINDOW);
  });

  it('keeps the minimum window on a slow shared link', () => {
    // Stays inside the 10 s RTT memory: the first RTT sample is the minimum.
    const windows = simulateLink({
      rttMs: 300,
      bytesPerMs: 40,
      durationMs: 9_000,
    });

    expect(Math.max(...windows)).toBeLessThan(MIN_WINDOW * 1.25);
  });

  it('keeps a small window when credit reports arrive in batches on a slow link', () => {
    // Two reports 1 ms apart once a round trip must not read as a burst of bandwidth.
    const windows = simulateLink({
      rttMs: 300,
      bytesPerMs: 40,
      durationMs: 9_000,
      reportEveryMs: 300,
    });

    expect(Math.max(...windows)).toBeLessThan(MIN_WINDOW * 1.25);
  });

  it('stops growing once the round trip shows its own bytes queued', () => {
    // Unlimited rate but a queue building on the path: RTT climbs from 300 ms to 3 s.
    const windows = simulateLink({
      rttMs: (elapsed) => 300 + elapsed / 3,
      durationMs: 8_000,
    });
    // Once the queue shows (RTT past twice the minimum plus slack, about 1 s in), the window holds.
    const held = windows[200]!;
    expect(Math.max(...windows.slice(200))).toBe(held);
    expect(held).toBeLessThan(MIN_WINDOW * 4);
  });

  it('keeps the minimum window for an app-limited topic', () => {
    const { gate, advance } = createGate({ window: MIN_WINDOW });

    for (let sequence = 0; sequence < 30; sequence++) {
      gate.offer({ sequence }, 1000);
      advance(100);
      gate.credit(gate.sent);
      advance(900);
    }

    expect(gate.window).toBe(MIN_WINDOW);
  });

  it('expires RTT and rate samples older than 10 s', () => {
    const { gate, advance } = createGate({ window: 100 });

    gate.offer({ sequence: 1 }, 100);
    advance(100);
    gate.credit(100);
    expect(gate.window).toBe(200);

    advance(20_000);
    gate.offer({ sequence: 2 }, 200);
    advance(400);
    gate.credit(300);

    // The old 100 ms RTT and its high rate sample are both gone.
    expect(gate.window).toBe(400);
  });

  it('uses the minimum window until the first rate sample', () => {
    const { gate, advance } = createGate({ window: 100 });

    gate.offer({ sequence: 1 }, 10);
    advance(5);
    gate.credit(10);

    expect(gate.window).toBe(100);
  });

  it('halves the window once, not to the minimum, when all rate samples have expired', () => {
    const { gate, advance } = createGate({ window: 100 });

    gate.offer({ sequence: 1 }, 100);
    advance(100);
    gate.credit(100);
    expect(gate.window).toBe(200);

    advance(20_000);
    gate.offer({ sequence: 2 }, 50);
    advance(100);
    gate.credit(150);

    expect(gate.window).toBe(100);
  });

  it('does not create sent-log marks for zero-byte updates', () => {
    const { gate, sent, advance } = createGate({
      window: 10_000,
      stallMs: Infinity,
      pauseAt: Infinity,
      maxPending: Infinity,
    });

    gate.offer({ sequence: 0 }, 10_000);
    advance(100);
    gate.credit(10_000);
    expect(gate.window).toBeCloseTo(20_000, 6);

    advance(50);
    gate.offer({ sequence: 1 }, 20_000);

    for (let sequence = 2; sequence <= 10_001; sequence += 1) {
      advance(0.01);
      gate.offer({ sequence }, 0);
    }

    advance(10);
    gate.credit(30_000);

    // Zero-byte marks would make the newest credit sample 10 ms old and inflate
    // the window to roughly 400,000 bytes.
    expect(gate.window).toBeCloseTo(36_364, 0);
    expect(sent[0]).toEqual({ sequence: 0 });
    expect(sent[1]).toEqual({ sequence: 1 });
    expect(sent).toHaveLength(10_002);
  });

  it('bounds the send log without stale baselines', () => {
    const { gate, advance } = createGate({
      window: 10_000,
      stallMs: Infinity,
      pauseAt: Infinity,
      maxPending: Infinity,
    });

    gate.offer({ sequence: 0 }, 10_000);
    advance(100);
    gate.credit(10_000);
    expect(gate.window).toBeCloseTo(20_000, 6);

    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      advance(1);
      gate.offer({ sequence }, 1);
    }

    // Leave 100 bytes in flight so the next burst builds a long send log.
    advance(1);
    gate.credit(10_900);

    for (let sequence = 1_001; sequence <= 10_000; sequence += 1) {
      advance(1);
      gate.offer({ sequence }, 1);
    }

    // Make the final credit sample while the gate is window-limited.
    gate.offer({ sequence: 10_001 }, 11_000);

    advance(100);
    gate.credit(20_000);

    // 9,100 bytes were credited over a 100 ms final RTT, against the 100 ms
    // minimum RTT; a stale last mark would keep the window at the minimum.
    expect(gate.window).toBeCloseTo(18_200, 6);
  });

  it('interpolates send time for credit positions between compacted marks', () => {
    const { gate, advance, now } = createGate({
      window: 1025,
      stallMs: Infinity,
      pauseAt: Infinity,
      maxPending: Infinity,
    });

    let sequence = 0;
    gate.offer({ sequence: sequence++ }, 1);
    advance(10);
    gate.credit(1);

    const batchStart = now();
    for (let index = 1; index <= 1025; index += 1) {
      advance(5);
      gate.offer({ sequence: sequence++ }, 1);
    }

    const expectedRtt = now() - (batchStart + 1023 * 5);
    gate.credit(1024);

    expect(gate.window).toBeCloseTo(2 * ((1024 - 1) / expectedRtt) * 10, 6);
  });

  it('shrinks a stale window by the periods elapsed, down to the minimum after a long idle gap', () => {
    const { gate, advance } = createGate({
      window: 100,
      stallMs: Infinity,
      pauseAt: Infinity,
      maxPending: Infinity,
    });

    gate.offer({ sequence: 1 }, 100);
    advance(100);
    gate.credit(100);
    const grown = gate.window;
    expect(grown).toBeGreaterThan(100);

    advance(3_600_000);
    gate.offer({ sequence: 2 }, 10);
    advance(100);
    gate.credit(110);

    expect(gate.window).toBe(100);
  });

  it('halves the window gradually after rate samples expire, never below the minimum', () => {
    const { gate, advance } = createGate({
      window: 100,
      stallMs: Infinity,
      pauseAt: Infinity,
      maxPending: Infinity,
    });

    let sequence = 0;
    gate.offer({ sequence: sequence++ }, 1000);
    advance(100);
    gate.credit(1000);
    expect(gate.window).toBeCloseTo(2000, 6);

    advance(11_000);

    const creditSparse = () => {
      advance(1);
      gate.offer({ sequence: sequence++ }, 100);
      advance(10);
      gate.credit(gate.sent);
    };

    creditSparse();
    expect(gate.window).toBeCloseTo(1000, 6);

    creditSparse();
    expect(gate.window).toBeCloseTo(1000, 6);

    advance(10_000);
    creditSparse();
    expect(gate.window).toBeCloseTo(500, 6);

    advance(10_000);
    creditSparse();
    expect(gate.window).toBeCloseTo(250, 6);

    advance(10_000);
    creditSparse();
    expect(gate.window).toBeCloseTo(125, 6);

    advance(10_000);
    creditSparse();
    expect(gate.window).toBe(100);
  });
});
