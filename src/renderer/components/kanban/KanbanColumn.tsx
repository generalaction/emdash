import React from 'react';

const KanbanColumn: React.FC<{
  title: string;
  count: number;
  onDropCard: (workspaceId: string) => void;
  children: React.ReactNode;
}> = ({ title, count, onDropCard, children }) => {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-medium">
        <span>{title}</span>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted/50 px-1.5 text-[11px]">
          {count}
        </span>
      </div>
      <div
        className="min-h-0 flex-1 space-y-2 overflow-auto p-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('text/plain');
          if (id) onDropCard(id);
          e.preventDefault();
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default KanbanColumn;
