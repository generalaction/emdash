import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE_SNAPSHOT } from '@shared/usage';
import {
  requestSnapshot,
  type WorkerLike,
  type WorkerRequest,
  type WorkerResponse,
} from './worker-request';

// ---------------------------------------------------------------------------
// Fake worker
// ---------------------------------------------------------------------------

class FakeWorker implements WorkerLike {
  sent: WorkerRequest[] = [];
  killed = false;

  private messageListeners: Array<(res: WorkerResponse) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
  }

  on(
    event: 'message' | 'exit',
    listener: ((res: WorkerResponse) => void) | ((code: number) => void)
  ): unknown {
    if (event === 'message') {
      this.messageListeners.push(listener as (res: WorkerResponse) => void);
    } else {
      this.exitListeners.push(listener as (code: number) => void);
    }
    return this;
  }

  off(
    event: 'message' | 'exit',
    listener: ((res: WorkerResponse) => void) | ((code: number) => void)
  ): unknown {
    if (event === 'message') {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    } else {
      this.exitListeners = this.exitListeners.filter((l) => l !== listener);
    }
    return this;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitMessage(res: WorkerResponse): void {
    for (const l of [...this.messageListeners]) l(res);
  }

  emitExit(code: number): void {
    for (const l of [...this.exitListeners]) l(code);
  }

  listenerCount(): number {
    return this.messageListeners.length + this.exitListeners.length;
  }
}

// ---------------------------------------------------------------------------
// Test payload helpers
// ---------------------------------------------------------------------------

const PAYLOAD = {
  indexPath: '/tmp/index.json',
  rates: [] as Array<[string, never]>,
  nowISO: new Date(0).toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requestSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the snapshot when a matching reqId response arrives', async () => {
    const w = new FakeWorker();
    const promise = requestSnapshot(w, PAYLOAD, 5000);

    const { reqId } = w.sent[0];
    w.emitMessage({ reqId, ok: true, snapshot: EMPTY_USAGE_SNAPSHOT });

    const result = await promise;
    expect(result).toBe(EMPTY_USAGE_SNAPSHOT);
  });

  it('rejects with the error message on an ok:false response', async () => {
    const w = new FakeWorker();
    const promise = requestSnapshot(w, PAYLOAD, 5000);

    const { reqId } = w.sent[0];
    w.emitMessage({ reqId, ok: false, error: 'pipeline exploded' });

    await expect(promise).rejects.toThrow('pipeline exploded');
  });

  it('ignores a mismatched reqId and resolves on the matching one', async () => {
    const w = new FakeWorker();
    const promise = requestSnapshot(w, PAYLOAD, 5000);

    const { reqId } = w.sent[0];
    // Emit a stale response from a previous request (wrong id)
    w.emitMessage({ reqId: reqId - 1, ok: true, snapshot: EMPTY_USAGE_SNAPSHOT });

    // Promise should still be pending — emit the real response now
    w.emitMessage({ reqId, ok: true, snapshot: EMPTY_USAGE_SNAPSHOT });

    const result = await promise;
    expect(result).toBe(EMPTY_USAGE_SNAPSHOT);
  });

  it('on timeout: rejects, kills the worker, and leaves no listeners', async () => {
    const w = new FakeWorker();
    const promise = requestSnapshot(w, PAYLOAD, 1000);

    vi.advanceTimersByTime(1000);

    await expect(promise).rejects.toThrow('usage worker timed out');
    expect(w.killed).toBe(true);
    expect(w.listenerCount()).toBe(0);
  });

  it('rejects with "exited (…)" when exit fires before any response', async () => {
    const w = new FakeWorker();
    const promise = requestSnapshot(w, PAYLOAD, 5000);

    w.emitExit(1);

    await expect(promise).rejects.toThrow('usage worker exited (1) before responding');
  });

  it('leaves no listeners after successful resolution', async () => {
    const w = new FakeWorker();
    const promise = requestSnapshot(w, PAYLOAD, 5000);

    const { reqId } = w.sent[0];
    w.emitMessage({ reqId, ok: true, snapshot: EMPTY_USAGE_SNAPSHOT });

    await promise;
    expect(w.listenerCount()).toBe(0);
  });
});
