import { describe, expect, it } from 'vitest';
import { BulkWindowController } from './bulk-window';

const MIB = 1024 * 1024;

describe('BulkWindowController', () => {
  it('starts at 2 MiB and grows toward 32 MiB while the window is full', () => {
    const controller = new BulkWindowController();
    expect(controller.windowBytes).toBe(2 * MIB);

    let now = 0;
    for (let i = 0; i < 20; i += 1) {
      controller.received(controller.windowBytes / 2, now);
      controller.sample(100, now);
      now += 100;
    }

    expect(controller.windowBytes).toBe(32 * MIB);
    expect(controller.windowBytes).toBeLessThanOrEqual(32 * MIB);
  });

  it('does not grow when the channel is not window-limited', () => {
    const controller = new BulkWindowController();

    controller.received(1, 0);
    controller.sample(100, 0);
    controller.received(1, 100);
    controller.sample(100, 100);

    expect(controller.windowBytes).toBe(2 * MIB);
  });

  it('shrinks on queueing delay and recovers when it falls back', () => {
    const controller = new BulkWindowController({ minBytes: 2 * MIB });
    let now = 0;

    for (let i = 0; i < 4; i += 1) {
      controller.received(controller.windowBytes / 2, now);
      controller.sample(100, now);
      now += 100;
    }

    const grown = controller.windowBytes;
    expect(grown).toBeGreaterThan(2 * MIB);

    controller.sample(220, now);
    now += 100;
    controller.sample(220, now);
    now += 100;
    expect(controller.windowBytes).toBeLessThan(grown);

    controller.sample(220, now);
    now += 100;
    controller.sample(220, now);
    now += 100;
    expect(controller.windowBytes).toBe(2 * MIB);

    for (let i = 0; i < 5 && controller.windowBytes === 2 * MIB; i += 1) {
      controller.received(controller.windowBytes / 2, now);
      controller.sample(100, now);
      now += 100;
    }

    expect(controller.windowBytes).toBeGreaterThan(2 * MIB);
  });

  it('forgets an old base RTT after baseWindowMs', () => {
    const controller = new BulkWindowController({ baseWindowMs: 1_000, minBytes: 2 * MIB });
    let now = 0;

    controller.received(1 * MIB, now);
    controller.sample(100, now);
    now = 100;
    controller.sample(220, now);
    now = 200;
    controller.sample(220, now);
    expect(controller.windowBytes).toBe(2 * MIB);

    now = 1_001;
    controller.received(1 * MIB, now);
    controller.sample(220, now);

    expect(controller.windowBytes).toBeGreaterThan(2 * MIB);
  });

  it('decides at most once per base RTT', () => {
    const controller = new BulkWindowController();
    let now = 0;

    for (let i = 0; i < 10; i += 1) {
      controller.received(controller.windowBytes / 2, now);
      controller.sample(100, now);
      now += 10;
    }

    expect(controller.windowBytes).toBe(2.5 * MIB);
  });

  it('ignores NaN, Infinity and negative samples', () => {
    const controller = new BulkWindowController();

    controller.sample(NaN, 0);
    controller.sample(Infinity, 0);
    controller.sample(-1, 0);
    expect(controller.windowBytes).toBe(2 * MIB);

    controller.received(1 * MIB, 100);
    controller.sample(100, 100);

    expect(controller.windowBytes).toBe(2.5 * MIB);
  });

  it('keeps deciding after 100,000 received chunks', () => {
    const controller = new BulkWindowController();
    const now = 1_000;
    const chunk = Math.floor(controller.windowBytes / 100_000);

    for (let i = 0; i < 100_000; i += 1) {
      controller.received(chunk, now);
    }

    controller.sample(100, now);

    expect(controller.windowBytes).toBe(2.5 * MIB);
  });
  it('shrinks below the stock 2 MiB window while the path stays queued', () => {
    const controller = new BulkWindowController();
    let now = 0;
    controller.sample(100, now);
    for (let i = 0; i < 40; i += 1) {
      now += 300;
      controller.received(controller.windowBytes, now);
      controller.sample(600, now);
    }

    expect(controller.windowBytes).toBe(512 * 1024);
  });
});
