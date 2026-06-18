import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { observer, Observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReorderList } from '@renderer/lib/components/reorder-list';
import { cn } from '@renderer/utils/utils';
import { Separator } from './separator';

function InlineEditInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="max-w-16 rounded-md border border-border bg-transparent p-1 text-sm text-foreground outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onConfirm(value);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export interface TabBarProps<TEntity> {
  tabs: TEntity[];
  activeTabId: string | undefined;
  getId: (entity: TEntity) => string;
  getLabel: (entity: TEntity) => string;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
  renderTabPrefix?: (entity: TEntity) => React.ReactNode;
  renderTabSuffix?: (entity: TEntity) => React.ReactNode;
  onRename?: (id: string, newName: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** Rendered in the right-side area. Caller is responsible for all buttons and their click handlers. */
  actions?: React.ReactNode;
}

export const TabBar = observer(function TabBar<TEntity>({
  tabs,
  activeTabId,
  getId,
  getLabel,
  onSelect,
  onRemove,
  renderTabPrefix,
  renderTabSuffix,
  onRename,
  onReorder,
  actions,
}: TabBarProps<TEntity>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  const updateScrollEdges = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    setScrollEdges({
      left: el.scrollLeft > 0,
      right: el.scrollLeft < maxScrollLeft - 1,
    });
  }, []);

  const scrollTabsBy = useCallback((direction: -1 | 1) => {
    const el = scrollContainerRef.current;
    if (!el) return;

    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.7), behavior: 'smooth' });
  }, []);

  const renderTab = (entity: TEntity) => {
    const id = getId(entity);
    const label = getLabel(entity);
    const isActive = activeTabId === id;
    const isEditing = editingId === id;

    return (
      <>
        <button
          key={id}
          onClick={() => onSelect(id)}
          onDoubleClick={() => onRename && setEditingId(id)}
          className={cn(
            'group relative bg-background-secondary flex flex-col h-full text-sm text-foreground-muted hover:bg-background-secondary-1/40',
            isActive &&
              'bg-background-secondary-1 opacity-100 text-foreground hover:bg-background-secondary-1 '
          )}
        >
          <div className={cn('flex items-center pl-3 pr-1 h-full', !onRemove && 'pr-3')}>
            <span className="flex items-center gap-1">
              {renderTabPrefix?.(entity)}
              {isEditing ? (
                <InlineEditInput
                  initialValue={label}
                  onConfirm={(newLabel) => {
                    setEditingId(null);
                    const trimmed = newLabel.trim();
                    if (trimmed && trimmed !== label) {
                      onRename?.(id, trimmed);
                    }
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span className="max-w-24 truncate p-1">{label}</span>
              )}
            </span>
            {onRemove && (
              <div className="relative flex size-5 items-center justify-center">
                {renderTabSuffix && (
                  <span className="transition-opacity group-hover:opacity-0">
                    {renderTabSuffix(entity)}
                  </span>
                )}
                <button
                  disabled={isEditing}
                  className="absolute inset-0 flex items-center justify-center rounded-md text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(id);
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
        </button>
        <Separator orientation="vertical" />
      </>
    );
  };

  const handleReorder = (newTabs: TEntity[]) => {
    for (let toIdx = 0; toIdx < newTabs.length; toIdx++) {
      const fromIdx = tabs.findIndex((t) => getId(t) === getId(newTabs[toIdx]));
      if (fromIdx !== toIdx) {
        onReorder?.(fromIdx, toIdx);
        break;
      }
    }
  };

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    updateScrollEdges();
    el.addEventListener('scroll', updateScrollEdges, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollEdges);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', updateScrollEdges);
      resizeObserver.disconnect();
    };
  }, [tabs.length, updateScrollEdges]);

  return (
    <div className="flex h-[41px] items-center justify-between border-b border-border bg-background-secondary">
      <div className="relative h-full min-w-0 flex-1">
        {onReorder ? (
          <ReorderList
            ref={scrollContainerRef}
            items={tabs}
            onReorder={handleReorder}
            axis="x"
            className="flex h-full w-full scrollbar-none overflow-x-auto"
            itemClassName="list-none flex h-full"
            getKey={(item) => getId(item)}
          >
            {(entity) => <Observer>{() => renderTab(entity)}</Observer>}
          </ReorderList>
        ) : (
          <div
            ref={scrollContainerRef}
            className="flex h-full w-full scrollbar-none overflow-x-auto"
          >
            {tabs.map((entity) => renderTab(entity))}
          </div>
        )}
        {scrollEdges.left && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-7 items-center justify-start bg-linear-to-r from-background-secondary via-background-secondary/90 to-transparent pl-1 text-foreground-muted">
            <button
              type="button"
              className="pointer-events-auto rounded-sm hover:text-foreground"
              aria-label="Scroll tabs left"
              onClick={() => scrollTabsBy(-1)}
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
        )}
        {scrollEdges.right && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-7 items-center justify-end bg-linear-to-l from-background-secondary via-background-secondary/90 to-transparent pr-1 text-foreground-muted">
            <button
              type="button"
              className="pointer-events-auto rounded-sm hover:text-foreground"
              aria-label="Scroll tabs right"
              onClick={() => scrollTabsBy(1)}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}) as <TEntity>(props: TabBarProps<TEntity>) => React.ReactElement;
