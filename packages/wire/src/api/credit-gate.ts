export type CreditGate<T = unknown> = {
  readonly sent: number;
  readonly consumed: number;
  readonly pendingBytes: number;
  readonly pressured: boolean;
  readonly window: number;
  offer(update: T, bytes: number): void;
  credit(consumed: number): void;
  check(): void;
  dispose(): void;
};

type QueuedUpdate<T> = {
  update: T;
  bytes: number;
};

type SentMark = {
  end: number;
  at: number;
  /** Bytes credited when this mark was sent, so a sample spans at least one round trip. */
  consumedAtSend: number;
  /** True once compaction folded an earlier send into this mark. */
  merged?: boolean;
};

type RttSample = {
  rtt: number;
  at: number;
};

type RateSample = {
  rate: number;
  at: number;
};

const RTT_MEMORY_MS = 10_000;
const RATE_SAMPLES = 8;
const QUEUE_SLACK_MS = 50;
const MAX_SENT_LOG_MARKS = 1_024;

type CreditGateOptions<T> = {
  window: number;
  send: (update: T) => void;
  onPressure: (pressured: boolean) => void;
  onOverflow: () => void;
  now?: () => number;
  stallMs?: number;
  pauseAt?: number;
  resumeAt?: number;
  maxPending?: number;
  maxWindow?: number;
};

export function createCreditGate<T>({
  window: minWindow,
  send,
  onPressure,
  onOverflow,
  now = () => performance.now(),
  stallMs = 30_000,
  pauseAt = 256 * 1024,
  resumeAt = 128 * 1024,
  maxPending = 1024 * 1024,
  maxWindow = 4 * 1024 * 1024,
}: CreditGateOptions<T>): CreditGate<T> {
  let queue: QueuedUpdate<T>[] = [];
  let sent = 0;
  let consumed = 0;
  let pendingBytes = 0;
  let pressured = false;
  let disposed = false;
  let inFlightSince: number | undefined;
  let effectiveWindow = minWindow;
  const sentLog: SentMark[] = [];
  // Increasing in rtt, so the front is the minimum of the unexpired samples.
  const rttSamples: RttSample[] = [];
  const rateSamples: RateSample[] = [];
  let latestRtt = 0;
  let hasSampledRate = false;
  let lastShrinkAt: number | undefined;
  let lastRateAt = 0;

  function currentTime(): number {
    return now();
  }

  function markInFlight(): void {
    if (sent > consumed) {
      if (inFlightSince === undefined) inFlightSince = currentTime();
    } else {
      inFlightSince = undefined;
    }
  }

  function setPressure(next: boolean): void {
    if (pressured === next) return;
    pressured = next;
    onPressure(next);
  }

  function canSend(bytes: number): boolean {
    return sent - consumed + bytes <= effectiveWindow || sent - consumed === 0;
  }

  function sendUpdate(update: T, bytes: number): void {
    send(update);
    if (bytes === 0) return;
    sent += bytes;
    if (sentLog.length >= MAX_SENT_LOG_MARKS) {
      // Halve the log by merging adjacent pairs after the first mark into their
      // later mark; the oldest mark stays so every credit still finds one.
      const merged: SentMark[] = [sentLog[0]!];
      for (let index = 2; index < sentLog.length; index += 2) {
        merged.push({ ...sentLog[index]!, merged: true });
      }
      if (sentLog.length % 2 === 0) merged.push(sentLog[sentLog.length - 1]!);
      sentLog.splice(0, sentLog.length, ...merged);
    }
    sentLog.push({ end: sent, at: currentTime(), consumedAtSend: consumed });
    markInFlight();
  }

  function overflow(): void {
    queue.length = 0;
    pendingBytes = 0;
    setPressure(false);
    // A gap resets the peer's view; restart the stall clock for bytes already
    // in flight so we do not gap again until another full stall period passes.
    if (sent > consumed) inFlightSince = currentTime();
    onOverflow();
  }

  function checkStall(): void {
    if (
      sent > consumed &&
      inFlightSince !== undefined &&
      currentTime() - inFlightSince >= stallMs
    ) {
      overflow();
    }
  }

  // Queued updates or a full window mean the credit rate was the limit, not
  // the app; only then is a delivery-rate sample taken.
  function windowLimited(): boolean {
    return queue.length > 0 || sent - consumed >= effectiveWindow;
  }

  // BBR-style delivery-rate estimate: bytes credited since the newest now
  // credited byte was sent, over the time since it was sent. It spans a full
  // round trip, so two credit reports arriving together cannot fake a burst.
  function recordSamples(nextConsumed: number, at: number): void {
    let newest: SentMark | undefined;
    while (sentLog.length > 0 && sentLog[0]!.end <= nextConsumed) {
      newest = sentLog.shift();
    }
    if (newest === undefined) return;
    const nextMark = sentLog[0];
    // Only a merged mark hides an earlier send; estimate its time by byte offset.
    if (nextMark?.merged && nextConsumed < nextMark.end) {
      const span = nextMark.end - newest.end;
      if (span > 0) {
        const fraction = (nextConsumed - newest.end) / span;
        newest = {
          end: nextConsumed,
          at: newest.at + (nextMark.at - newest.at) * fraction,
          consumedAtSend:
            newest.consumedAtSend + (nextMark.consumedAtSend - newest.consumedAtSend) * fraction,
        };
      }
    }
    const rtt = at - newest.at;
    if (rtt > 0 && windowLimited()) {
      rateSamples.push({ rate: (nextConsumed - newest.consumedAtSend) / rtt, at });
      lastRateAt = at;
      if (rateSamples.length > RATE_SAMPLES) rateSamples.shift();
      hasSampledRate = true;
    }
    while (rttSamples.length > 0 && rttSamples[rttSamples.length - 1]!.rtt >= rtt) {
      rttSamples.pop();
    }
    rttSamples.push({ rtt, at });
    latestRtt = rtt;
  }

  // Never expires the newest sample, so a minimum RTT is always kept.
  function expireRtt(at: number): void {
    while (rttSamples.length > 1 && at - rttSamples[0]!.at > RTT_MEMORY_MS) {
      rttSamples.shift();
    }
  }

  function expireRateSamples(at: number): void {
    while (rateSamples.length > 0 && at - rateSamples[0]!.at > RTT_MEMORY_MS) {
      rateSamples.shift();
    }
  }

  // Halve once per full memory period since the last rate sample (or the last
  // halving), so a long idle gap shrinks a stale window in proportion.
  function shrinkWindow(at: number): void {
    const since = lastShrinkAt ?? lastRateAt;
    const periods = Math.floor((at - since) / RTT_MEMORY_MS);
    if (periods < 1) return;
    effectiveWindow = Math.max(minWindow, Math.floor(effectiveWindow / 2 ** Math.min(periods, 30)));
    lastShrinkAt = since + periods * RTT_MEMORY_MS;
  }

  function updateWindow(at: number): void {
    if (rttSamples.length === 0) {
      effectiveWindow = minWindow;
      lastShrinkAt = undefined;
      return;
    }
    if (rateSamples.length === 0) {
      if (hasSampledRate) {
        shrinkWindow(at);
      } else {
        effectiveWindow = minWindow;
      }
      return;
    }
    lastShrinkAt = undefined;
    const minRtt = rttSamples[0]!.rtt;
    const target = 2 * Math.max(...rateSamples.map((sample) => sample.rate)) * minRtt;
    // Heuristic: a round trip well above the minimum suggests our own bytes are
    // queued; never grow then, so a shared slow link does not bloat.
    const queued = latestRtt > 2 * minRtt + QUEUE_SLACK_MS;
    const next = queued ? Math.min(target, effectiveWindow) : target;
    effectiveWindow = Math.max(minWindow, Math.min(maxWindow, next));
  }

  function measure(nextConsumed: number): void {
    const at = currentTime();
    recordSamples(nextConsumed, at);
    expireRtt(at);
    expireRateSamples(at);
    updateWindow(at);
  }

  function drain(): void {
    while (queue.length > 0) {
      const next = queue[0]!;
      if (!canSend(next.bytes)) return;
      queue.shift();
      pendingBytes -= next.bytes;
      if (pressured && pendingBytes <= resumeAt) setPressure(false);
      sendUpdate(next.update, next.bytes);
    }
  }

  return {
    get sent(): number {
      return sent;
    },
    get consumed(): number {
      return consumed;
    },
    get pendingBytes(): number {
      return pendingBytes;
    },
    get pressured(): boolean {
      return pressured;
    },
    get window(): number {
      return effectiveWindow;
    },
    offer(update: T, bytes: number): void {
      if (disposed) return;
      checkStall();
      if (queue.length === 0 && canSend(bytes)) {
        sendUpdate(update, bytes);
        return;
      }
      pendingBytes += bytes;
      if (pendingBytes >= pauseAt) setPressure(true);
      if (pendingBytes > maxPending) {
        overflow();
        return;
      }
      queue.push({ update, bytes });
    },
    credit(value: number): void {
      if (disposed) return;
      checkStall();
      const nextConsumed = Math.min(value, sent);
      if (nextConsumed <= consumed) return;
      measure(nextConsumed);
      consumed = nextConsumed;
      if (sent > consumed) {
        inFlightSince = currentTime();
      } else {
        inFlightSince = undefined;
      }
      drain();
    },
    check(): void {
      if (disposed) return;
      checkStall();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      queue = [];
      pendingBytes = 0;
      setPressure(false);
    },
  };
}
