const MIB = 1024 * 1024;
const STOCK_WINDOW = 2 * MIB;
const EWMA_ALPHA = 0.25;
const MIN_DECISION_INTERVAL_MS = 50;
const SHRINK_FACTOR = 0.7;
const GROW_FACTOR = 1.25;
const SLOT_MS = 50;
const MAX_BASE_RTT_MS = 2_000; // fixed-slot received ring covers base RTTs up to this bound
const RING_SLOT_COUNT = MAX_BASE_RTT_MS / SLOT_MS + 1;

export type BulkWindowOptions = {
  minBytes?: number;
  maxBytes?: number;
  targetDelayMs?: number;
  baseWindowMs?: number;
};

export class BulkWindowController {
  private readonly minBytes: number;
  private readonly maxBytes: number;
  private readonly targetDelayMs: number;
  private readonly baseWindowMs: number;
  private window: number;
  private smoothedRtt: number | undefined;
  private lastDecisionAt = Number.NEGATIVE_INFINITY;
  private readonly rttBuckets = new Map<number, { at: number; value: number }>();
  private readonly receivedSlotIds = new Array<number>(RING_SLOT_COUNT).fill(
    Number.NEGATIVE_INFINITY
  );
  private readonly receivedSlotBytes = new Array<number>(RING_SLOT_COUNT).fill(0);

  constructor(options: BulkWindowOptions = {}) {
    // Below ssh2's stock 2 MiB, so a slow link's send queue can drain (20 Mbit x 300 ms is about 0.75 MB in flight).
    this.minBytes = options.minBytes ?? 512 * 1024;
    this.maxBytes = options.maxBytes ?? 32 * MIB; // restores throughput on a 300 ms path without unbounded host memory
    this.targetDelayMs = options.targetDelayMs ?? 50; // keep bulk bytes from adding more than one echo budget
    this.baseWindowMs = options.baseWindowMs ?? 30_000; // long enough for an idle path's minimum RTT to emerge
    this.window = Math.min(Math.max(STOCK_WINDOW, this.minBytes), this.maxBytes); // start where stock ssh2 is
  }

  sample(rttMs: number, now: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0 || !Number.isFinite(now)) return;

    const bucket = Math.floor(now / 1000);
    const current = this.rttBuckets.get(bucket);
    if (!current || rttMs <= current.value) {
      this.rttBuckets.set(bucket, { at: now, value: rttMs });
    }

    this.smoothedRtt =
      this.smoothedRtt === undefined
        ? rttMs
        : this.smoothedRtt + EWMA_ALPHA * (rttMs - this.smoothedRtt);

    this.pruneRtt(now);
    this.maybeDecide(now);
  }

  received(bytes: number, now: number): void {
    if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(now)) return;

    const slot = Math.floor(now / SLOT_MS);
    const index = ((slot % RING_SLOT_COUNT) + RING_SLOT_COUNT) % RING_SLOT_COUNT;

    if (this.receivedSlotIds[index] !== slot) {
      this.receivedSlotIds[index] = slot;
      this.receivedSlotBytes[index] = 0;
    }

    this.receivedSlotBytes[index] += bytes;
  }

  get windowBytes(): number {
    return this.window;
  }

  private pruneRtt(now: number): void {
    const cutoff = now - this.baseWindowMs;
    for (const [bucket, entry] of [...this.rttBuckets]) {
      if (entry.at <= cutoff) this.rttBuckets.delete(bucket);
    }
  }

  private baseRtt(): number | undefined {
    let base: number | undefined;
    for (const entry of this.rttBuckets.values()) {
      base = base === undefined ? entry.value : Math.min(base, entry.value);
    }
    return base;
  }

  private maybeDecide(now: number): void {
    const base = this.baseRtt();
    if (base === undefined || this.smoothedRtt === undefined) return;

    const decisionInterval = Math.max(MIN_DECISION_INTERVAL_MS, base);
    if (now - this.lastDecisionAt < decisionInterval) return;
    this.lastDecisionAt = now;

    const queueingDelay = this.smoothedRtt - base;
    if (queueingDelay > this.targetDelayMs) {
      this.window = Math.max(this.minBytes, Math.floor(this.window * SHRINK_FACTOR));
      return;
    }

    if (
      queueingDelay < this.targetDelayMs &&
      this.receivedBytesInLastBaseRtt(now, base) >= this.window / 2
    ) {
      this.window = Math.min(this.maxBytes, Math.floor(this.window * GROW_FACTOR));
    }
  }

  private receivedBytesInLastBaseRtt(now: number, baseRtt: number): number {
    const lookbackMs = Math.min(baseRtt, MAX_BASE_RTT_MS);
    const currentSlot = Math.floor(now / SLOT_MS);
    const oldestSlot = Math.floor((now - lookbackMs) / SLOT_MS);

    let bytes = 0;
    for (let index = 0; index < RING_SLOT_COUNT; index += 1) {
      const slot = this.receivedSlotIds[index];
      if (slot >= oldestSlot && slot <= currentSlot) {
        bytes += this.receivedSlotBytes[index];
      }
    }
    return bytes;
  }
}
