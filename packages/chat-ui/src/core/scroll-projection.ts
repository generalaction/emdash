/**
 * Scroll-projection module — the single owner of scroll intent application.
 *
 * Extracted from ChatRoot (improvement-plan M1). Owns the state machine that
 * answers "geometry changed — who compensates scrollTop?":
 *
 *   - `expectedScrollTop` — the last scrollTop this module wrote, used to
 *     classify scroll events as self-writes vs. real user gestures.
 *   - Smooth-scroll suppression — while a native smooth scroll animates,
 *     browser-driven scrollTop movement must not be misread as user input.
 *   - The scroll-settle window — projection is suppressed until the gesture
 *     has been quiet for SCROLL_SETTLE_MS.
 *   - `needsProject` — coalesces N geometry invalidations into at most one
 *     projection per frame (write phase).
 *   - Anchor projection math — ScrollMode ('tail' | 'anchor') → scrollTop.
 *   - Scroll commands (top / bottom / item) and prepend compensation.
 *
 * The module is pure TypeScript: every DOM read/write, virtualizer lookup, and
 * Solid signal access is injected through {@link ScrollProjectionDeps}, so the
 * whole state machine is unit-testable in node.
 *
 * Behavior contract:
 *   - Exactly one code path writes scrollTop: {@link ScrollProjection.writeScrollTop}.
 *     Smooth scrolls are scheduler-driven tweens advanced in the write phase —
 *     there is no native scrollTo({behavior:'smooth'}) and no suppression flag;
 *     tween frames are ordinary self-writes tracked by expectedScrollTop.
 *   - project() flushes canvas height before writing scrollTop so the browser
 *     never clamps against a stale canvas height.
 */

import type { ScrollMode } from '@state/chat-state';
import type { ScrollToItemOptions } from '@/commands';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Distance from the bottom (px) within which the viewport counts as "at bottom". */
export const STICK_THRESHOLD_PX = 48;

// Maximum absolute scrollTop delta that can originate from a writeScrollTop
// self-write (sub-pixel / device-pixel rounding). Any delta larger than this
// is classified as a real user scroll and updates lastUserScrollAt.
// Keeping it tight (0.5 px) avoids suppressing short-distance programmatic
// adjustments that should also be treated as self-writes.
export const USER_SCROLL_EPSILON = 0.5;

// After a user scroll, suppress anchor projection until the gesture has been
// quiet this long. Must be comfortably longer than one rAF frame (~16 ms) so a
// momentary hold or an inter-event gap mid-drag does not open the gate and let
// project() jump the thumb forward. Tunable.
export const SCROLL_SETTLE_MS = 120;

// Scheduler-driven smooth-scroll tween duration: proportional to distance,
// clamped so short hops stay snappy and long jumps don't drag on.
export const SCROLL_TWEEN_MIN_MS = 160;
export const SCROLL_TWEEN_MAX_MS = 420;

/** Decelerating ease — approximates the feel of native smooth scrolling. */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

// ── Dependency port ───────────────────────────────────────────────────────────

/**
 * Everything the projection state machine needs from its host, injected so the
 * module never touches the DOM, the virtualizer, or Solid signals directly.
 */
export type ScrollProjectionDeps = {
  // ── Lifecycle ──
  /** True once the scroll element exists. Guards every DOM-effecting method. */
  mounted(): boolean;

  // ── Geometry reads (pure; may read Solid signals untracked) ──
  padTop(): number;
  /** Viewport height signal (ResizeObserver-driven). Used by anchor math. */
  viewHeight(): number;
  /** Live scroll-element clientHeight (DOM read). Used by scrollToItem. */
  clientHeight(): number;
  maxScrollTop(): number;
  contentH(): number;

  // ── Unit / heightmap reads ──
  unitCount(): number;
  unitIdAt(index: number): string | undefined;
  /** First unit index for the item id, or -1. */
  unitIndexOf(id: string): number;
  /** Index of the unit at canvas offset y (virtualizer findIndex). */
  findIndexAt(y: number): number;
  topOf(index: number): number;
  sizeOf(index: number): number;

  // ── Scroll intent ──
  getAnchor(): ScrollMode;
  setAnchor(mode: ScrollMode): void;
  /** props.stickToBottom !== false */
  stickToBottom(): boolean;

  // ── Effects ──
  setCanvasHeight(px: number): void;
  setScrollTop(px: number): void;
  /** Arm the frame scheduler. */
  requestFrame(): void;
  /** requestAnimationFrame seam (scrollToItem's post-write correction). */
  raf(fn: () => void): void;
  /** performance.now seam. */
  now(): number;
};

// ── Observation result ────────────────────────────────────────────────────────

export type ScrollObservation =
  /** No user movement (self-write echo — including tween frames — or idle). */
  | { kind: 'idle'; userDelta: number }
  /**
   * A real user scroll. Any tween is cancelled and intent re-derivation is
   * scheduled for when the gesture settles (the settle window gates intent
   * re-derivation only — height compensation stays same-frame).
   */
  | { kind: 'user'; userDelta: number; atBottom: boolean };

export type ScrollProjection = {
  /**
   * Read-phase entry point: classify the observed scrollTop against
   * expectedScrollTop and keep gesture state current. Real user movement marks
   * intent dirty; re-derivation happens in the write phase once settled.
   */
  observeScroll(st: number): ScrollObservation;
  /**
   * Write-phase entry point. In order: advance the smooth-scroll tween, apply
   * pending same-frame height compensation, re-derive intent if the gesture
   * has settled, then run at most one projection. Returns true when any
   * scrollTop write happened (the caller must re-capture shadow scrollTop).
   */
  runWritePhase(): boolean;
  /** Mark projection as needed (geometry changed). Coalesced per frame. */
  invalidate(): void;
  /**
   * Same-frame height compensation: a row height changed by `delta`. If the
   * row sits entirely above the viewport top, scrollTop is adjusted by the
   * same delta in the next write phase — unconditionally, settle window or
   * not — so content under the viewport never shifts.
   */
  compensateHeightChange(index: number, delta: number): void;
  /**
   * Re-derive intent immediately from the last observed position if a gesture
   * left it dirty (dispose path: persist a current anchor, not a stale one).
   */
  flushIntent(): void;
  /** Project a scroll intent immediately (attach / host setScrollMode). */
  project(mode: ScrollMode): void;
  /** The one clamped scrollTop writer. */
  writeScrollTop(top: number): void;
  /** Whether st is within the stick threshold of the bottom. */
  isAtBottom(st: number): boolean;
  scrollToTop(opts?: { behavior?: ScrollBehavior }): void;
  scrollToBottom(opts?: { behavior?: ScrollBehavior }): void;
  scrollToItem(id: string, opts?: ScrollToItemOptions): void;
  /** Capture the top-edge anchor before a history prepend. */
  capturePrependAnchor(st: number): { anchorId: string | undefined; anchorOffset: number };
  /** Restore the captured anchor after the prepend landed. */
  compensatePrepend(anchorId: string, anchorOffset: number): void;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createScrollProjection(deps: ScrollProjectionDeps): ScrollProjection {
  // Last scrollTop we wrote. Seeded to 0; adopted from the arithmetic clamp
  // after each write so clamped positions are never counted as user movement.
  let expectedScrollTop = 0;

  // Scheduler-driven smooth-scroll tween. Replaces native scrollTo({behavior:
  // 'smooth'}) so this module stays the ONLY scrollTop writer: every tween
  // frame goes through writeScrollTop, which keeps expectedScrollTop in sync —
  // tween echoes classify as self-writes with no suppression flag needed.
  let tween: { from: number; to: number; start: number; duration: number } | null = null;

  // now() of the last real user scroll or smooth-scroll animation frame.
  // Projection is suppressed until SCROLL_SETTLE_MS after this timestamp —
  // covering the whole gesture, not just one frame. Initialised to 0 so the
  // first write-phase call (no prior scroll) is settled.
  let lastUserScrollAt = 0;

  // Set on geometry change so a single projection runs in the write phase
  // instead of one per measured row.
  let needsProject = false;

  // Sum of height deltas from rows entirely above the viewport top, awaiting
  // same-frame application in the write phase. Keeps content visually
  // stationary during active gestures (the ticket-01 scroll-jump fix).
  let pendingCompensation = 0;

  // True after a real user scroll until intent is re-derived (at settle) or an
  // explicit intent supersedes it. While dirty, projection is deferred — a
  // stale anchor must never be projected over the user's position.
  let intentDirty = false;

  const isAtBottom = (st: number): boolean => deps.maxScrollTop() - st <= STICK_THRESHOLD_PX;

  const writeScrollTop = (top: number): void => {
    if (!deps.mounted()) return;
    // Clamp arithmetically: project() already flushed canvas height, so
    // maxScrollTop() matches what the browser would compute. Avoiding the
    // read-back eliminates the forced layout reflow it caused. Safe because
    // USER_SCROLL_EPSILON filters any sub-pixel divergence in observeScroll.
    const clamped = Math.max(0, Math.min(top, deps.maxScrollTop()));
    deps.setScrollTop(clamped);
    expectedScrollTop = clamped;
    // Arm the scheduler so the write phase re-derives the visible set for the
    // new scroll position (the scroll event may not fire for programmatic sets).
    deps.requestFrame();
  };

  const startTween = (to: number): void => {
    const from = expectedScrollTop;
    const dist = Math.abs(to - from);
    if (dist < 1) {
      writeScrollTop(to);
      return;
    }
    tween = {
      from,
      to,
      start: deps.now(),
      duration: Math.min(SCROLL_TWEEN_MAX_MS, Math.max(SCROLL_TWEEN_MIN_MS, dist / 2)),
    };
    deps.requestFrame();
  };

  const cancelTween = (): void => {
    tween = null;
  };

  const advanceTween = (): boolean => {
    if (!tween) return false;
    const t = Math.min(1, (deps.now() - tween.start) / tween.duration);
    const pos = tween.from + (tween.to - tween.from) * easeOutCubic(t);
    if (t >= 1) {
      const target = tween.to;
      tween = null;
      writeScrollTop(target);
      return true;
    }
    writeScrollTop(pos);
    return true;
  };

  // The ONE function that applies a scroll intent. Flush canvas height first so
  // the browser never clamps scrollTop to a stale (outgoing) canvas height —
  // this is the root cause of "open at top after tab switch".
  // Cancels any in-flight tween: an explicit intent application (attach, host
  // setScrollMode, settled projection) supersedes an animation in progress.
  const project = (m: ScrollMode): void => {
    if (!deps.mounted()) return;
    cancelTween();
    // An absolute projection supersedes any pending relative correction and any
    // pending gesture-driven re-derivation.
    pendingCompensation = 0;
    intentDirty = false;
    // Synchronously update canvas height so scrollTop is never clamped.
    deps.setCanvasHeight(deps.contentH());

    if (m.kind === 'anchor') {
      const i = deps.unitIndexOf(m.itemId);
      if (i >= 0) {
        const rowTop = deps.topOf(i) + deps.padTop();
        const target =
          m.edge === 'top'
            ? rowTop + m.offset
            : rowTop + deps.sizeOf(i) - deps.viewHeight() + m.offset;
        const next = Math.max(0, target);
        // Sub-pixel no-op guard: if the settle correction is smaller than 1 px
        // (anchor already matches the current position), skip the write so the
        // browser thumb is never perturbed by a near-zero adjustment. Compare
        // against expectedScrollTop (our last written value) rather than a DOM
        // read to preserve the no-DOM-read-in-write-phase invariant.
        if (Math.abs(next - expectedScrollTop) < 1) return;
        writeScrollTop(next);
        return;
      }
      // Anchor item not found (transcript not yet loaded); fall through to tail.
    }
    // tail mode (or anchor item not found yet): re-pin to end.
    if (deps.stickToBottom()) {
      writeScrollTop(deps.maxScrollTop());
    }
  };

  // Re-derive scroll intent from a settled position: tail when within the
  // stick threshold of the bottom, otherwise a top-edge anchor on the unit
  // under the viewport top.
  const rederiveIntent = (st: number): void => {
    const nowAtBottom = isAtBottom(st);
    const prevAtBottom = deps.getAnchor().kind === 'tail';
    if (nowAtBottom) {
      if (!prevAtBottom) {
        deps.setAnchor({ kind: 'tail' });
      }
    } else {
      const pt = deps.padTop();
      const anchorUnitIdx = deps.findIndexAt(Math.max(0, st - pt));
      const anchorUnitId = deps.unitIdAt(anchorUnitIdx);
      if (anchorUnitId !== undefined) {
        deps.setAnchor({
          kind: 'anchor',
          itemId: anchorUnitId,
          edge: 'top',
          offset: st - (deps.topOf(anchorUnitIdx) + pt),
        });
      }
    }
  };

  const observeScroll = (st: number): ScrollObservation => {
    const userDelta = st - expectedScrollTop;

    // USER_SCROLL_EPSILON filters sub-pixel self-write rounding (including
    // tween-frame echoes) so writeScrollTop is never misread as a user scroll.
    if (Math.abs(userDelta) > USER_SCROLL_EPSILON) {
      // A real user gesture supersedes any in-flight smooth-scroll tween.
      cancelTween();
      lastUserScrollAt = deps.now();
      expectedScrollTop = st;
      // Intent re-derivation is deferred to the settle window (write phase):
      // deriving per scroll event bakes uncompensated geometry shifts into the
      // anchor offset — the ticket-01 continuous-wheel drift.
      intentDirty = true;
      return { kind: 'user', userDelta, atBottom: isAtBottom(st) };
    }

    return { kind: 'idle', userDelta };
  };

  // An explicit intent (scroll command / host setScrollMode) supersedes any
  // pending gesture-driven re-derivation.
  const applyIntent = (m: ScrollMode): void => {
    intentDirty = false;
    deps.setAnchor(m);
  };

  const flushIntent = (): void => {
    if (!intentDirty) return;
    intentDirty = false;
    rederiveIntent(expectedScrollTop);
  };

  // Same-frame compensation: rows entirely above the viewport top shift the
  // content under the viewport when they settle from estimate to exact; the
  // exact delta is applied to scrollTop in the next write phase regardless of
  // the settle window. Rows intersecting or below the viewport top don't move
  // what the user sees — no compensation.
  //
  // Classification uses the row's PRE-change extent: its own top is unchanged
  // by its resize and its old bottom = new bottom − delta. A row that grows
  // across the viewport top was above it when the user was looking.
  const compensateHeightChange = (index: number, delta: number): void => {
    if (delta === 0) return;
    const viewportTop = expectedScrollTop + pendingCompensation - deps.padTop();
    const oldBottom = deps.topOf(index) + deps.sizeOf(index) - delta;
    if (oldBottom > viewportTop) return;
    if (tween) {
      // Fold the shift into the tween so its curve lands on shifted content.
      tween.from += delta;
      tween.to += delta;
      return;
    }
    pendingCompensation += delta;
    deps.requestFrame();
  };

  const applyCompensation = (): boolean => {
    if (pendingCompensation === 0) return false;
    const delta = pendingCompensation;
    pendingCompensation = 0;
    // Flush canvas height first so the DOM write is never clamped stale.
    deps.setCanvasHeight(deps.contentH());
    writeScrollTop(expectedScrollTop + delta);
    return true;
  };

  const projectIfNeeded = (): boolean => {
    // Projection is coalesced: at most one project() per frame (not per row).
    // Deferred while a tween owns the position or while intent is dirty (a
    // stale anchor must never be projected over the user's live position);
    // same-frame compensation covers visual stability in the meantime.
    if (!needsProject) return false;
    if (tween || intentDirty) {
      deps.requestFrame();
      return false;
    }
    needsProject = false;
    project(deps.getAnchor());
    return true;
  };

  const runWritePhase = (): boolean => {
    let wrote = advanceTween();
    if (applyCompensation()) wrote = true;
    // Re-derive intent once the gesture has settled; keep the loop alive while
    // waiting so the derivation fires without further events.
    if (intentDirty && !tween) {
      if (deps.now() - lastUserScrollAt > SCROLL_SETTLE_MS) {
        intentDirty = false;
        rederiveIntent(expectedScrollTop);
      } else {
        deps.requestFrame();
      }
    }
    if (projectIfNeeded()) wrote = true;
    return wrote;
  };

  const scrollToTop = (opts?: { behavior?: ScrollBehavior }): void => {
    if (!deps.mounted()) return;
    cancelTween();
    const firstUnitId = deps.unitIdAt(0);
    if (firstUnitId !== undefined) {
      applyIntent({ kind: 'anchor', itemId: firstUnitId, edge: 'top', offset: -deps.padTop() });
    }
    if (opts?.behavior === 'smooth') {
      startTween(0);
    } else {
      writeScrollTop(0);
    }
  };

  const scrollToBottom = (opts?: { behavior?: ScrollBehavior }): void => {
    if (!deps.mounted()) return;
    cancelTween();
    const target = deps.maxScrollTop();
    applyIntent({ kind: 'tail' });
    if (opts?.behavior === 'smooth') {
      startTween(target);
    } else {
      writeScrollTop(target);
    }
  };

  const scrollToItem = (id: string, opts?: ScrollToItemOptions): void => {
    if (!deps.mounted()) return;
    cancelTween();

    const n = deps.unitCount();
    let unitIdx = -1;
    for (let i = 0; i < n; i++) {
      if (deps.unitIdAt(i) === id) {
        unitIdx = i;
        break;
      }
    }
    if (unitIdx < 0) return;

    let itemTotalH = 0;
    for (let i = unitIdx; i < n; i++) {
      if (deps.unitIdAt(i) !== id) break;
      itemTotalH += deps.sizeOf(i);
    }

    const idx = unitIdx;
    const rowH = itemTotalH;

    const align = opts?.align ?? 'start';
    const extraOffset = opts?.offset ?? 0;
    const behavior = opts?.behavior ?? 'auto';

    const computeTarget = () => {
      const rowTop = deps.topOf(idx) + deps.padTop();
      const vh = deps.clientHeight();
      let target: number;
      if (align === 'center') {
        target = rowTop - (vh - rowH) / 2;
      } else if (align === 'end') {
        target = rowTop - vh + rowH;
      } else {
        target = rowTop;
      }
      return Math.max(0, target + extraOffset);
    };

    const t0 = computeTarget();

    // Commit the scroll as a top-edge anchor intent so height compensation
    // keeps the row stable as content changes above.
    const anchorUnitId = deps.unitIdAt(idx);
    if (anchorUnitId !== undefined) {
      const newOffset = t0 - (deps.topOf(idx) + deps.padTop());
      applyIntent({
        kind: 'anchor',
        itemId: anchorUnitId,
        edge: 'top',
        offset: newOffset + extraOffset,
      });
    }

    if (behavior === 'smooth') {
      startTween(t0);
    } else {
      writeScrollTop(t0);
      deps.raf(() => {
        const t1 = computeTarget();
        writeScrollTop(t1);
      });
    }
  };

  const capturePrependAnchor = (
    st: number
  ): { anchorId: string | undefined; anchorOffset: number } => {
    const anchorUnitIdx = deps.findIndexAt(Math.max(0, st - deps.padTop()));
    const anchorId = deps.unitIdAt(anchorUnitIdx);
    const anchorOffset = st - (deps.topOf(anchorUnitIdx) + deps.padTop());
    return { anchorId, anchorOffset };
  };

  const compensatePrepend = (anchorId: string, anchorOffset: number): void => {
    const newUnitIdx = deps.unitIndexOf(anchorId);
    if (newUnitIdx >= 0) {
      const newTop = deps.topOf(newUnitIdx) + deps.padTop() + anchorOffset;
      writeScrollTop(newTop);
    }
  };

  return {
    observeScroll,
    runWritePhase,
    invalidate: () => {
      needsProject = true;
    },
    compensateHeightChange,
    flushIntent,
    project,
    writeScrollTop,
    isAtBottom,
    scrollToTop,
    scrollToBottom,
    scrollToItem,
    capturePrependAnchor,
    compensatePrepend,
  };
}
