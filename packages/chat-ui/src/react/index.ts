/**
 * React adapter for @emdash/chat-ui.
 *
 * Uses React.createElement (no JSX) to avoid dual-JSX-runtime conflicts.
 * Mounts the Solid ChatRoot on mount, exposes the handle via onReady,
 * and disposes on unmount.
 *
 * padTop / padBottom are deliberately excluded from the initial mountOpts so
 * they don't get locked in at mount time. A separate effect pushes updates
 * through setContentPadding whenever those props change.
 *
 * commands / onReachStart / onAtBottomChange are also pushed reactively so
 * inline callbacks do not go stale after React re-renders.
 */

import { createElement, useEffect, useRef } from 'react';
import type { ChatCommands, ChatHandle, MountChatOptions, ScrollToItemOptions } from '../index';
import { mountChat } from '../index';
import type { ChatItem } from '../model';

export type ChatTranscriptProps = Omit<
  MountChatOptions,
  'padTop' | 'padBottom' | 'commands' | 'onReachStart' | 'onAtBottomChange'
> & {
  /** Called once after the Solid root is mounted with the chat handle. */
  onReady?: (handle: ChatHandle) => void;
  style?: React.CSSProperties;
  className?: string;
  /**
   * Top padding (px) reserved inside the canvas. Pushed reactively via
   * setContentPadding so it can change without remounting.
   */
  padTop?: number;
  /**
   * Bottom padding (px) reserved inside the canvas — use this to keep the last
   * message clear of a floating composer. Pushed reactively via
   * setContentPadding so the composer's measured height can drive it.
   */
  padBottom?: number;
  /**
   * Command callbacks invoked by user interactions inside the transcript.
   * Pushed reactively so inline callbacks are never stale.
   */
  commands?: ChatCommands;
  /**
   * Called when the user scrolls near the top. Host should fetch older items
   * and call handle.loadOlder(items).
   * Pushed reactively so inline callbacks are never stale.
   */
  onReachStart?: () => void;
  /**
   * Called when the "at bottom" sticky state changes.
   * Pushed reactively so inline callbacks are never stale.
   */
  onAtBottomChange?: (atBottom: boolean) => void;
};

export function ChatTranscript(props: ChatTranscriptProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const handleRef = useRef<ChatHandle | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const {
      onReady,
      style: _style,
      className: _className,
      padTop: _padTop,
      padBottom: _padBottom,
      commands: _commands,
      onReachStart,
      onAtBottomChange,
      ...mountOpts
    } = propsRef.current;

    const handle = mountChat(ref.current, {
      ...mountOpts,
      commands: propsRef.current.commands ?? {},
      // Thread stable wrappers that read from propsRef at call time — never stale.
      onReachStart: onReachStart ? () => propsRef.current.onReachStart?.() : undefined,
      onAtBottomChange: onAtBottomChange
        ? (b: boolean) => propsRef.current.onAtBottomChange?.(b)
        : undefined,
    });
    handleRef.current = handle;
    onReady?.(handle);
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push padding updates reactively whenever the props change — without
  // remounting the Solid root, which would lose scroll position and state.
  useEffect(() => {
    handleRef.current?.setContentPadding({ top: props.padTop, bottom: props.padBottom });
  }, [props.padTop, props.padBottom]);

  // Push command callbacks reactively so inline functions are never stale.
  useEffect(() => {
    if (props.commands !== undefined) {
      handleRef.current?.setCommands(props.commands);
    }
  }, [props.commands]);

  return createElement('div', {
    ref,
    style: { height: '100%', ...props.style },
    className: props.className,
  });
}

// Re-export imperative handle types so consumers can use them from the
// React entry point without importing from the Solid entry point.
export type { ChatHandle, ChatCommands, ScrollToItemOptions };
export type LoadOlderFn = (items: ChatItem[]) => void;
