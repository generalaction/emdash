/**
 * ShrinkWrap — content-hugging padded box primitive.
 *
 * Renders an `inline-block` or `block` element that hugs its content with
 * configurable padding, border radius, and optional visual classes.
 *
 * The measurement path and the rendering path must share the same `padX`/`padY`
 * values for layout parity. Each preset (InlineCodeChip, UserBubble) therefore
 * exposes its constants so callers can reference them in `measure()` without
 * re-deriving the values from a theme accessor.
 *
 * @example
 * // Custom one-off
 * <ShrinkWrap padX={6} padY={2} radius={4} class="bg-zinc-100">
 *   {children}
 * </ShrinkWrap>
 *
 * @example
 * // Use a preset
 * <InlineCodeChip>{children}</InlineCodeChip>
 */

import type { JSX } from 'solid-js';
import { useTheme } from '../ThemeContext';

// ── Core primitive ─────────────────────────────────────────────────────────────

export type ShrinkWrapProps = {
  padX: number;
  padY: number;
  radius?: number;
  class?: string;
  /** Defaults to 'inline-block'. */
  display?: 'inline-block' | 'block';
  /** Explicit width (px). When omitted the element shrinks to content. */
  width?: number;
  children: JSX.Element;
};

export function ShrinkWrap(props: ShrinkWrapProps) {
  return (
    <span
      class={props.class}
      style={{
        display: props.display ?? 'inline-block',
        padding: `${props.padY}px ${props.padX}px`,
        'border-radius': props.radius !== undefined ? `${props.radius}px` : undefined,
        ...(props.width !== undefined ? { width: `${props.width}px` } : {}),
      }}
    >
      {props.children}
    </span>
  );
}

/**
 * Factory that produces a ShrinkWrap component with pre-bound defaults.
 * Use when you need a consistent chip variant in multiple places.
 */
export function makeShrinkWrap(
  defaults: Omit<ShrinkWrapProps, 'children' | 'width'>
): (props: { children: JSX.Element; width?: number }) => JSX.Element {
  return (props) => <ShrinkWrap {...defaults} width={props.width}>{props.children}</ShrinkWrap>;
}

// ── InlineCodeChip preset ─────────────────────────────────────────────────────

// ── UserBubble preset constants ───────────────────────────────────────────────

/**
 * Horizontal padding of the user message bubble on each side (px).
 * This value MUST match `BUBBLE_PAD_X` in message/layout.ts — it is
 * separated here so ShrinkWrap.tsx has no dependency on message internals.
 * If you change one, change the other.
 */
export const USER_BUBBLE_PAD_X = 14;
/** Vertical padding of the user message bubble on each side (px). */
export const USER_BUBBLE_PAD_Y = 8;
/** Border radius of the user message bubble (px). */
export const USER_BUBBLE_RADIUS = 12;

// ── InlineCodeChip preset constants ──────────────────────────────────────────

/**
 * Horizontal padding used by inline code chips (px).
 * This value must match the `inlineCodeExtraWidth` divided by 2 that is
 * fed into FontConfig / pretext so layout and rendering stay in sync.
 */
export const INLINE_CODE_PAD_X = 6;
/** Vertical padding used by inline code chips (px). */
export const INLINE_CODE_PAD_Y = 2;

/**
 * Inline code chip preset — inline-block box with monospace font chrome.
 * Reads `inlineCodePadX`/`inlineCodePadY` from the active theme so the
 * visual padding matches the pretext measurement.
 */
export function InlineCodeChip(props: { children: JSX.Element }) {
  const theme = useTheme();
  const d = () => theme().density;

  return (
    <ShrinkWrap
      padX={d().inlineCodePadX}
      padY={d().inlineCodePadY}
      radius={4}
      display="inline-block"
      class="rounded bg-[var(--chat-code-inline-bg,rgba(0,0,0,0.06))]"
    >
      {props.children}
    </ShrinkWrap>
  );
}
