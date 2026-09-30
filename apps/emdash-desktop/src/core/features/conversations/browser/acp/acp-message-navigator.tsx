import type { UserMessageNavigation } from '@emdash/chat-ui';
import { Button, ScrollContainer, Tooltip } from '@emdash/ui/react/primitives';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

type MessageNavigatorProps = {
  navigation: UserMessageNavigation;
  hasOlderHistory: boolean;
  loading: boolean;
  error: string | null;
  onLoadOlder: () => void;
  onNavigate: (id: string) => void;
};

const MARKER_HEIGHT = 24;
const MIN_CONTROL_SPACE = 28;

export function AcpMessageNavigator({
  navigation,
  hasOlderHistory,
  loading,
  error,
  onLoadOlder,
  onNavigate,
}: MessageNavigatorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusTarget = useRef<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const { items, currentId } = navigation;
  const indices = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items]);
  const currentIndex = indices.get(currentId ?? '') ?? 0;
  const tabStopIndex = indices.get(focusedId ?? '') ?? currentIndex;
  const availableHeight = Math.max(0, navigation.viewportHeight - navigation.bottomInset - 16);
  const showOlder = hasOlderHistory && availableHeight >= MIN_CONTROL_SPACE;
  const markerHeight = Math.min(
    360,
    availableHeight - (showOlder ? MIN_CONTROL_SPACE : 0),
    Math.max(MIN_CONTROL_SPACE, items.length * MARKER_HEIGHT)
  );
  const showMarkers = items.length > 0 && markerHeight >= MIN_CONTROL_SPACE;
  const getItemKey = useCallback((index: number) => items[index].id, [items]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    getItemKey,
    estimateSize: () => MARKER_HEIGHT,
    overscan: 3,
    enabled: showMarkers,
    initialRect: { width: 32, height: Math.max(0, markerHeight) },
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      // Retain the roving tab stop even when the user scrolls it out of view.
      return visible.includes(tabStopIndex)
        ? visible
        : [...visible, tabStopIndex].sort((a, b) => a - b);
    },
  });
  const measuredMarkerHeight = virtualizer.scrollRect?.height ?? markerHeight;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (
      !showMarkers ||
      !viewport ||
      measuredMarkerHeight <= 0 ||
      viewport.contains(document.activeElement)
    )
      return;
    virtualizer.scrollToIndex(currentIndex, { align: 'center' });
  }, [currentIndex, items, showMarkers, markerHeight, measuredMarkerHeight, virtualizer]);

  useLayoutEffect(() => {
    const marker = focusTarget.current ? markerRefs.current.get(focusTarget.current) : null;
    if (!marker) return;
    focusTarget.current = null;
    marker.focus();
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (event.key) {
      case 'ArrowUp':
        next = Math.max(0, index - 1);
        break;
      case 'ArrowDown':
        next = Math.min(items.length - 1, index + 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === index) {
      focusTarget.current = null;
      virtualizer.scrollToIndex(next, { align: 'auto' });
      return;
    }
    focusTarget.current = items[next].id;
    setFocusedId(items[next].id);
    virtualizer.scrollToIndex(next, { align: 'auto' });
  };

  return (
    <nav
      aria-label="User messages"
      aria-hidden={!showOlder && !showMarkers ? true : undefined}
      style={{
        position: 'absolute',
        left: 4,
        top: 16,
        bottom: navigation.bottomInset,
        width: 32,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        overflow: 'hidden',
        zIndex: 20,
      }}
    >
      <Tooltip.Provider delay={150}>
        {showOlder && (
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <Button
                  size="xs"
                  icon
                  aria-label={error ? 'Retry loading earlier messages' : 'Load earlier messages'}
                  disabled={loading}
                  onClick={onLoadOlder}
                  style={{ flexShrink: 0 }}
                />
              }
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <ChevronUp />}
            </Tooltip.Trigger>
            <Tooltip.Content side="right">{error ?? 'Load earlier messages'}</Tooltip.Content>
          </Tooltip.Root>
        )}
        {showMarkers && (
          <ScrollContainer
            ref={viewportRef}
            maxHeight={markerHeight}
            size={8}
            style={{ height: markerHeight, minHeight: 0, width: '100%', flexShrink: 0 }}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const index = row.index;
                const item = items[index];
                const preview = item.text.trim().replace(/\s+/g, ' ').slice(0, 100) || 'Attachment';
                const current = item.id === currentId;
                return (
                  <div
                    key={item.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: MARKER_HEIGHT,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <Tooltip.Root>
                      <Tooltip.Trigger
                        render={
                          <Button
                            size="xs"
                            icon
                            aria-label={`Go to message ${index + 1}: ${preview}`}
                            aria-current={current ? 'step' : undefined}
                            data-message-id={item.id}
                            tabIndex={index === tabStopIndex ? 0 : -1}
                            ref={(marker) => {
                              if (marker) markerRefs.current.set(item.id, marker);
                              else markerRefs.current.delete(item.id);
                            }}
                            onFocus={() => setFocusedId(item.id)}
                            onKeyDown={(event) => handleKeyDown(event, index)}
                            onClick={() => onNavigate(item.id)}
                            style={{ display: 'flex', marginInline: 'auto' }}
                          />
                        }
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: current ? 16 : 8,
                            height: current ? 3 : 2,
                            borderRadius: 2,
                            background: 'currentColor',
                          }}
                        />
                      </Tooltip.Trigger>
                      <Tooltip.Content side="right" showArrow={false}>
                        <div style={{ width: 256, maxWidth: 'calc(100vw - 80px)' }}>
                          <div className="mb-1 text-xs opacity-70">
                            Message {index + 1} of {items.length}
                          </div>
                          <div
                            style={{
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              display: '-webkit-box',
                              WebkitBoxOrient: 'vertical',
                              WebkitLineClamp: 5,
                              overflow: 'hidden',
                            }}
                          >
                            {item.text.trim() || 'Attachment'}
                          </div>
                        </div>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                );
              })}
            </div>
          </ScrollContainer>
        )}
      </Tooltip.Provider>
      {error && (
        <span role="status" className="sr-only">
          {error}
        </span>
      )}
    </nav>
  );
}
