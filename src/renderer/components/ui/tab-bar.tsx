import { Plus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { ReorderList } from '@renderer/components/reorder-list';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
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
      className="max-w-16 bg-transparent outline-none text-sm border border-border p-1 rounded-md"
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
  onRemove: (id: string) => void;
  onAdd: () => void;
  renderTabPrefix?: (entity: TEntity) => React.ReactNode;
  onRename?: (id: string, newName: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  addButton?: React.ReactNode;
}

export const TabBar = observer(function TabBar<TEntity>({
  tabs,
  activeTabId,
  getId,
  getLabel,
  onSelect,
  onRemove,
  onAdd,
  renderTabPrefix,
  onRename,
  onReorder,
  addButton,
}: TabBarProps<TEntity>) {
  const [editingId, setEditingId] = useState<string | null>(null);

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
            'group relative bg-background-1 flex flex-col h-full text-sm hover:bg-muted',
            isActive && 'bg-background opacity-100 [box-shadow:inset_0_1px_0_var(--primary)]'
          )}
        >
          <div className="flex items-center pl-3 pr-1 h-full">
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
            <button
              disabled={isEditing}
              className="size-5 hover:bg-background-2 text-foreground-muted flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(id);
              }}
            >
              <X className="size-4" />
            </button>
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

  return (
    <div className="flex items-center justify-between h-[41px] border-b border-border bg-background-1">
      {onReorder ? (
        <ReorderList
          items={tabs}
          onReorder={handleReorder}
          axis="x"
          className="flex overflow-x-auto w-full h-full"
          itemClassName="list-none flex h-full"
          getKey={(item) => getId(item)}
        >
          {renderTab}
        </ReorderList>
      ) : (
        <div className="flex overflow-x-auto h-full">
          {tabs.map((entity, index) => renderTab(entity, index))}
        </div>
      )}
      {addButton ? (
        <div onClick={onAdd} className="shrink-0">
          {addButton}
        </div>
      ) : (
        <Button
          variant="outline"
          className="size-7 shrink-0"
          size="icon-xs"
          onClick={onAdd}
          title="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}) as <TEntity>(props: TabBarProps<TEntity>) => React.ReactElement;
