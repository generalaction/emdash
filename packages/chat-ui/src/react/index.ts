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
 */

import { createElement, useEffect, useRef } from 'react';
import type { MountChatOptions, ChatHandle } from '../index';
import { mountChat } from '../index';

export type ChatTranscriptProps = Omit<MountChatOptions, 'padTop' | 'padBottom'> & {
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
      ...mountOpts
    } = propsRef.current;
    const handle = mountChat(ref.current, mountOpts);
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

  return createElement('div', {
    ref,
    style: { height: '100%', ...props.style },
    className: props.className,
  });
}
