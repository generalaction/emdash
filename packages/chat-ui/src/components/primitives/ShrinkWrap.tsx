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

import { useTheme } from '@components/contexts/ThemeContext';
import type { JSX } from 'solid-js';
import { inlineCodeChipVisual } from './shrink-wrap.css';

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
  return (props) => (
    <ShrinkWrap {...defaults} width={props.width}>
      {props.children}
    </ShrinkWrap>
  );
}

/**
 * Inline code chip preset — inline-block box with monospace font chrome.
 * Reads `inlineCodePadX`/`inlineCodePadY` from the active theme's chip config
 * so the visual padding matches the pretext measurement.
 */
export function InlineCodeChip(props: { children: JSX.Element }) {
  const theme = useTheme();
  const chips = () => theme().chips;

  return (
    <ShrinkWrap
      padX={chips().inlineCodePadX}
      padY={chips().inlineCodePadY}
      radius={4}
      display="inline-block"
      class={inlineCodeChipVisual}
    >
      {props.children}
    </ShrinkWrap>
  );
}
