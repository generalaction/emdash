import React from 'react';
import { GitBranch } from 'lucide-react';
import type { Task } from '../../types/app';
import { providerAssets } from '../../providers/assets';
import { providerMeta, type UiProvider } from '../../providers/meta';
import { activityStore } from '../../lib/activityStore';
import ProviderTooltip from './ProviderTooltip';
import { Spinner } from '../ui/spinner';
import { Checkbox } from '../ui/checkbox';
import TaskDeleteButton from '../TaskDeleteButton';
import { useTaskChanges } from '../../hooks/useTaskChanges';
import { ChangesBadge } from '../TaskChanges';

function resolveProvider(taskId: string): UiProvider | null {
  try {
    const v = localStorage.getItem(`taskProvider:${taskId}`);
    if (!v) return null;
    const id = v.trim() as UiProvider;
    return id in providerAssets ? id : null;
  } catch {
    return null;
  }
}

const KanbanCard: React.FC<{
  ws: Task;
  onOpen?: (ws: Task) => void;
  onDelete?: () => void | Promise<void | boolean>;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  draggable?: boolean;
}> = ({
  ws,
  onOpen,
  onDelete,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  draggable = true,
}) => {
  const SHOW_PROVIDER_LOGOS = false;
  // Resolve single-provider from legacy localStorage (single-agent tasks)
  const provider = resolveProvider(ws.id);
  const asset = provider ? providerAssets[provider] : null;

  // Multi‑agent badges (metadata lists selected providers)
  const multi = ws.metadata?.multiAgent?.enabled ? ws.metadata?.multiAgent : null;
  const providerRuns = (multi?.providerRuns?.map((pr) => pr.provider) ?? []) as UiProvider[];
  const legacyProviders = Array.isArray(multi?.providers) ? (multi?.providers as UiProvider[]) : [];
  const providers = Array.from(new Set([...providerRuns, ...legacyProviders]));
  const adminProvider: UiProvider | null = (multi?.selectedProvider as UiProvider) || null;

  const handleOpen = () => onOpen?.(ws);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  React.useEffect(() => activityStore.subscribe(ws.id, setBusy), [ws.id]);

  const { totalAdditions, totalDeletions } = useTaskChanges(ws.path, ws.id);

  const canDrag = draggable && !isSelectMode;
  const handleClick = () => {
    if (isSelectMode && onToggleSelect) {
      onToggleSelect();
      return;
    }
    handleOpen();
  };

  return (
    <ProviderTooltip
      providers={providers.length > 0 ? providers : provider ? [provider] : []}
      adminProvider={adminProvider}
      side="top"
      delay={150}
      taskPath={ws.path}
      taskName={ws.name}
    >
      <div
        role="button"
        tabIndex={0}
        className={[
          'group rounded-lg border bg-background p-3 shadow-sm transition hover:bg-muted/40 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
          isSelectMode && isSelected ? 'border-primary ring-1 ring-primary/40' : 'border-border',
        ].join(' ')}
        draggable={canDrag}
        onDragStart={(e) => {
          if (!canDrag) return;
          e.dataTransfer.setData('text/plain', ws.id);
        }}
        onDoubleClick={() => {
          if (!isSelectMode) handleOpen();
        }}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-between gap-2 overflow-hidden">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{ws.name}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {providers.length > 0 && (SHOW_PROVIDER_LOGOS || busy) ? (
                <div className="flex shrink-0 items-center gap-1">
                  {busy ? <Spinner size="sm" className="shrink-0 text-muted-foreground" /> : null}
                  {SHOW_PROVIDER_LOGOS
                    ? providers.slice(0, 3).map((p) => {
                        const a = providerAssets[p];
                        if (!a) return null;
                        const isAdmin = adminProvider && p === adminProvider;
                        const label = providerMeta[p]?.label ?? a.name;
                        const tooltip = isAdmin ? `${label} (admin)` : label;
                        return (
                          <span
                            key={`${ws.id}-prov-${p}`}
                            className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0 text-[11px] leading-none text-muted-foreground ${
                              isAdmin ? 'ring-1 ring-primary/60' : ''
                            }`}
                            title={tooltip}
                          >
                            <img
                              src={a.logo}
                              alt={a.alt}
                              className={`h-3.5 w-3.5 shrink-0 rounded-sm ${
                                a.invertInDark ? 'dark:invert' : ''
                              }`}
                            />
                          </span>
                        );
                      })
                    : null}
                  {SHOW_PROVIDER_LOGOS && providers.length > 3 ? (
                    <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      +{providers.length - 3}
                    </span>
                  ) : null}
                </div>
              ) : asset ? (
                SHOW_PROVIDER_LOGOS ? (
                  <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0 text-[11px] leading-none text-muted-foreground">
                    {busy ? <Spinner size="sm" className="shrink-0 text-muted-foreground" /> : null}
                    <img
                      src={asset.logo}
                      alt={asset.alt}
                      className={`h-3.5 w-3.5 shrink-0 rounded-sm ${
                        asset.invertInDark ? 'dark:invert' : ''
                      }`}
                    />
                  </span>
                ) : busy ? (
                  <Spinner size="sm" className="shrink-0 text-muted-foreground" />
                ) : null
              ) : null}

              {isSelectMode && onToggleSelect ? (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect()}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${ws.name}`}
                  className="h-4 w-4 rounded border-muted-foreground/50 data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground"
                />
              ) : onDelete ? (
                <TaskDeleteButton
                  taskName={ws.name}
                  taskId={ws.id}
                  taskPath={ws.path}
                  onConfirm={async () => {
                    try {
                      setIsDeleting(true);
                      await onDelete();
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  isDeleting={isDeleting}
                  aria-label={`Delete task ${ws.name}`}
                  className={`text-muted-foreground ${
                    isDeleting ? '' : 'opacity-0 transition-opacity group-hover:opacity-100'
                  }`}
                />
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{ws.branch}</span>
            </div>
            {(totalAdditions > 0 || totalDeletions > 0) && (
              <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
            )}
          </div>
        </div>

        {SHOW_PROVIDER_LOGOS && adminProvider && providerAssets[adminProvider] ? (
          <div className="mt-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">Admin:</span>
              <img
                src={providerAssets[adminProvider].logo}
                alt={providerAssets[adminProvider].alt}
                className={`h-3.5 w-3.5 rounded-sm ${
                  providerAssets[adminProvider].invertInDark ? 'dark:invert' : ''
                }`}
              />
            </span>
          </div>
        ) : null}
      </div>
    </ProviderTooltip>
  );
};

export default React.memo(KanbanCard, (prevProps, nextProps) => {
  return (
    prevProps.ws.id === nextProps.ws.id &&
    prevProps.ws.name === nextProps.ws.name &&
    prevProps.ws.branch === nextProps.ws.branch &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isSelectMode === nextProps.isSelectMode
  );
});
