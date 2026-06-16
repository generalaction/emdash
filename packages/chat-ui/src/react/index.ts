/**
 * React adapter for @emdash/chat-ui.
 *
 * Uses React.createElement (no JSX) to avoid dual-JSX-runtime conflicts.
 * Mounts the Solid ChatRoot on mount, exposes the handle via onReady,
 * and disposes on unmount.
 */

import { createElement, useEffect, useRef } from 'react';
import type { MountChatOptions, ChatHandle } from '../index';
import { mountChat } from '../index';

export type ChatTranscriptProps = MountChatOptions & {
  /** Called once after the Solid root is mounted with the chat handle. */
  onReady?: (handle: ChatHandle) => void;
  style?: React.CSSProperties;
  className?: string;
};

export function ChatTranscript(props: ChatTranscriptProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!ref.current) return;
    const { onReady, style, className, ...mountOpts } = propsRef.current;
    const handle = mountChat(ref.current, mountOpts);
    onReady?.(handle);
    return () => handle.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createElement('div', {
    ref,
    style: { height: '100%', ...props.style },
    className: props.className,
  });
}
