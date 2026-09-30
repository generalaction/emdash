import type { UserMessageNavigation } from '@emdash/chat-ui';
import { Button, ScrollContainer, Tooltip } from '@emdash/ui/react/primitives';
import { ChevronUp, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

type MessageNavigatorProps = {
  navigation: UserMessageNavigation;
  hasOlderHistory: boolean;
  loading: boolean;
  error: string | null;
  onLoadOlder: () => void;
  onNavigate: (id: string) => void;
};

export function AcpMessageNavigator({
  navigation,
  hasOlderHistory,
  loading,
  error,
  onLoadOlder,
  onNavigate,
}: MessageNavigatorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const { items, currentId } = navigation;
  const tabStopId = items.some((item) => item.id === focusedId)
    ? focusedId
    : (currentId ?? items[0]?.id);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.contains(document.activeElement)) return;
    const marker = Array.from(
      viewport.querySelectorAll<HTMLButtonElement>('[data-message-id]')
    ).find((button) => button.dataset.messageId === currentId);
    if (!marker) return;
    viewport.scrollTo({
      top: marker.offsetTop - (viewport.clientHeight - marker.offsetHeight) / 2,
    });
  }, [currentId, items]);

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
    const buttons = viewportRef.current?.querySelectorAll<HTMLButtonElement>('[data-message-id]');
    buttons?.[next]?.focus();
  };

  return (
    <nav
      aria-label="User messages"
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
        zIndex: 20,
      }}
    >
      <Tooltip.Provider delay={150}>
        {hasOlderHistory && (
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <Button
                  size="xs"
                  icon
                  aria-label={error ? 'Retry loading earlier messages' : 'Load earlier messages'}
                  disabled={loading}
                  onClick={onLoadOlder}
                />
              }
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <ChevronUp />}
            </Tooltip.Trigger>
            <Tooltip.Content side="right">{error ?? 'Load earlier messages'}</Tooltip.Content>
          </Tooltip.Root>
        )}
        <ScrollContainer
          ref={viewportRef}
          maxHeight="100%"
          size={8}
          style={{ minHeight: 0, width: '100%', maxHeight: 360 }}
        >
          {items.map((item, index) => {
            const preview = item.text.trim().replace(/\s+/g, ' ').slice(0, 100) || 'Attachment';
            const current = item.id === currentId;
            return (
              <Tooltip.Root key={item.id}>
                <Tooltip.Trigger
                  render={
                    <Button
                      size="xs"
                      icon
                      aria-label={`Go to message ${index + 1}: ${preview}`}
                      aria-current={current ? 'step' : undefined}
                      data-message-id={item.id}
                      tabIndex={item.id === tabStopId ? 0 : -1}
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
            );
          })}
        </ScrollContainer>
      </Tooltip.Provider>
      {error && (
        <span role="status" className="sr-only">
          {error}
        </span>
      )}
    </nav>
  );
}
