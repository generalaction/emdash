import { action, makeObservable, observable } from 'mobx';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

// ── Sink ──────────────────────────────────────────────────────────────────────

/** Receives pixel dimensions from the ResizeObserver. PaneStore satisfies this structurally. */
export interface PaneDimensionSink {
  readonly dimensions: { width: number; height: number } | null;
  setDimensions(width: number, height: number): void;
  /** Register the element whose bounding rect is used for manual re-measurement. */
  attachMeasureSource?(el: HTMLElement | null): void;
  /** Re-read the registered element's bounding rect and push it through setDimensions. */
  remeasure?(): void;
}

class StandaloneSink implements PaneDimensionSink {
  dimensions: { width: number; height: number } | null = null;

  constructor() {
    makeObservable(this, { dimensions: observable, setDimensions: action });
  }

  setDimensions(width: number, height: number): void {
    this.dimensions = { width, height };
  }
}

/** Standalone observable sink for panels that have no PaneStore (e.g. the terminal drawer). */
export function createPaneDimensionSink(): PaneDimensionSink {
  return new StandaloneSink();
}

// ── Context ───────────────────────────────────────────────────────────────────

export interface PaneDimensionsValue {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sink: PaneDimensionSink;
}

const PaneDimensionContext = createContext<PaneDimensionsValue | null>(null);

export function usePaneDimensions(): PaneDimensionsValue | null {
  return useContext(PaneDimensionContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function PaneDimensionProvider({
  sink,
  children,
}: {
  sink: PaneDimensionSink;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sink.attachMeasureSource?.(containerRef.current);
    return () => sink.attachMeasureSource?.(null);
  }, [sink]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      sink.setDimensions(width, height);
    });
    observer.observe(el);

    // Initial measurement.
    const { width, height } = el.getBoundingClientRect();
    if (width > 0 || height > 0) sink.setDimensions(width, height);

    return () => {
      observer.disconnect();
    };
  }, [sink]);

  return (
    <PaneDimensionContext.Provider value={{ containerRef, sink }}>
      <div ref={containerRef} className="flex h-full min-h-0 flex-col">
        {children}
      </div>
    </PaneDimensionContext.Provider>
  );
}
