/**
 * createFrameScheduler — a demand-driven, phased rAF loop.
 *
 * Enforces a strict read → animate → write phase ordering per frame so DOM
 * geometry reads (scrollTop/clientHeight) are always batched before any writes.
 * The loop re-schedules only when a phase signals more work is pending, so it
 * sleeps completely when the UI is idle (no battery cost from a perpetual rAF).
 *
 * Phases:
 *   read     — read DOM geometry once per frame into signals (shadow).
 *   animate  — advance all active tweens; return true while any remain active.
 *   write    — flush coalesced height total and apply at most one scroll write;
 *              return true if more write work was queued this tick.
 *
 * Usage:
 *   const scheduler = createFrameScheduler({ read, animate, write });
 *   scheduler.request();   // arm from any event handler
 *   scheduler.dispose();   // cancel in onCleanup
 */

export type FrameSchedulerPhases = {
  read: () => void;
  animate: () => boolean;
  write: () => boolean;
};

export type FrameScheduler = {
  /** Arm the loop for the next frame (idempotent if already requested). */
  request: () => void;
  /** Cancel any pending frame. Call in onCleanup. */
  dispose: () => void;
};

export function createFrameScheduler(phases: FrameSchedulerPhases): FrameScheduler {
  let rafId: number | null = null;

  const tick = () => {
    rafId = null;
    phases.read();
    const moreAnimate = phases.animate();
    const moreWrite = phases.write();
    if (moreAnimate || moreWrite) request();
  };

  const request = () => {
    if (rafId === null) rafId = requestAnimationFrame(tick);
  };

  const dispose = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  return { request, dispose };
}
