/**
 * ProjectedTranscript — thin React mount wrapper for the imperative engine.
 *
 * React's only job here is:
 *   1. Create a single <div> to hand ownership to ImperativeChat.
 *   2. Construct LayoutStore + ViewStateStore once.
 *   3. Instantiate ImperativeChat on mount, dispose on unmount.
 *
 * Zero per-row React reconciliation occurs after mount. All DOM construction,
 * virtualization, and MobX subscriptions live inside ImperativeChat.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { FontConfig } from '../../measure/fonts';
import { DEFAULT_FONT_CONFIG } from '../../measure/fonts';
import type { TranscriptStore } from '../../state/transcript-store';
import { ViewStateStore } from '../../state/view-state-store';
import { ImperativeChat } from '../engine/imperative-chat';
import { LayoutStore } from '../layout/layout-store';
import type { ImperativeSlots } from '../slots';
import style from '../projected.module.css';

export type ProjectedTranscriptProps = {
  store: TranscriptStore;
  fonts?: FontConfig;
  slots?: ImperativeSlots;
  stickToBottom?: boolean;
  className?: string;
  /**
   * Optional external ViewStateStore.  When provided the component uses it
   * directly instead of creating an internal one.  Useful for stories and
   * tests that need to pre-seed collapse state.
   */
  viewState?: ViewStateStore;
  /**
   * Optional external LayoutStore.  When provided the component uses it
   * directly instead of creating an internal one.
   */
  layoutStore?: LayoutStore;
};

export function ProjectedTranscript({
  store,
  fonts = DEFAULT_FONT_CONFIG,
  slots,
  stickToBottom = true,
  className,
  viewState: externalViewState,
  layoutStore: externalLayoutStore,
}: ProjectedTranscriptProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  // Internal stores created once — engine owns subsequent subscriptions.
  // External stores take precedence when provided.
  const internalLayoutStore = useMemo(() => new LayoutStore(fonts), [fonts]);
  const internalViewState = useMemo(() => new ViewStateStore(), []);
  const layoutStore = externalLayoutStore ?? internalLayoutStore;
  const viewState = externalViewState ?? internalViewState;

  // Stable ref for slots so the engine always sees the latest value
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  useEffect(() => {
    if (!ref.current) return;
    const engine = new ImperativeChat({
      scrollEl: ref.current,
      store,
      viewState,
      layoutStore,
      get slots() {
        return slotsRef.current;
      },
      stickToBottom,
      fonts,
    });
    return () => engine.dispose();
    // Intentionally omit deps: engine owns lifecycle; re-mounting on prop changes
    // would thrash all rows. Store mutations are observed via MobX inside engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootCls = className
    ? `${style['pchat-transcript']} ${className}`
    : style['pchat-transcript'];
  return <div ref={ref} className={rootCls} />;
}
