import React from 'react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { providerAssets } from '../../providers/assets';
import { providerMeta, type UiProvider } from '../../providers/meta';
import { GitBranch } from 'lucide-react';

type ProviderTooltipProps = {
  providers: UiProvider[];
  adminProvider?: UiProvider | null;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  children: React.ReactNode;
  taskPath?: string;
  taskName?: string;
};

export const ProviderTooltip: React.FC<ProviderTooltipProps> = ({
  providers,
  adminProvider = null,
  side = 'top',
  delay = 150,
  children,
  taskPath,
  taskName,
}) => {
  const items = React.useMemo(() => {
    const seen = new Set<string>();
    const ids = (Array.isArray(providers) ? providers : []).filter(Boolean);
    return ids
      .map((id) => {
        const meta = providerMeta[id as UiProvider];
        const asset = providerAssets[id as UiProvider];
        const label = meta?.label || asset?.name || String(id);
        return {
          id: id as UiProvider,
          label,
          logo: asset?.logo,
          invert: !!asset?.invertInDark,
        };
      })
      .filter((x) => {
        if (!x.label) return false;
        if (seen.has(x.label)) return false;
        seen.add(x.label);
        return true;
      });
  }, [providers]);

  const adminLabel = React.useMemo(() => {
    if (!adminProvider) return null;
    const meta = providerMeta[adminProvider as UiProvider];
    const asset = providerAssets[adminProvider as UiProvider];
    return meta?.label || asset?.name || String(adminProvider);
  }, [adminProvider]);

  // Diff summary state
  const [open, setOpen] = React.useState(false);
  const [diffSummary, setDiffSummary] = React.useState<{
    files: number;
    additions: number;
    deletions: number;
    top: Array<{ path: string; additions: number; deletions: number; status?: string }>;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const fetchSummary = async () => {
      if (!open) return;
      if (!taskPath) return;
      try {
        const res = await (window as any).electronAPI?.getGitStatus?.(taskPath);
        if (!res?.success || !Array.isArray(res?.changes)) {
          if (!cancelled) setDiffSummary(null);
          return;
        }
        const filtered = (res.changes as Array<any>).filter(
          (c) =>
            !String(c?.path || '').startsWith('.emdash/') && String(c?.path || '') !== 'PLANNING.md'
        );
        const additions = filtered.reduce((s, c) => s + Number(c?.additions || 0), 0);
        const deletions = filtered.reduce((s, c) => s + Number(c?.deletions || 0), 0);
        const top = filtered
          .slice()
          .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
          .slice(0, 3)
          .map((c) => ({
            path: String(c.path || ''),
            additions: Number(c.additions || 0),
            deletions: Number(c.deletions || 0),
            status: String(c.status || ''),
          }));
        if (!cancelled) setDiffSummary({ files: filtered.length, additions, deletions, top });
      } catch {
        if (!cancelled) setDiffSummary(null);
      }
    };
    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, [open, taskPath]);

  if (!items || items.length === 0) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={delay}>
      <Tooltip onOpenChange={setOpen}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-xs rounded-md border border-border bg-background p-2 text-xs shadow-sm"
        >
          {taskName ? (
            <div className="mb-1 flex items-center gap-1.5 text-code font-semibold leading-tight text-foreground">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate" title={taskName}>
                {taskName}
              </span>
            </div>
          ) : null}
          <div className="mb-1 mt-0.5 font-medium text-foreground">Providers</div>
          <div className="flex flex-col gap-1">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 text-foreground/90">
                {it.logo ? (
                  <img
                    src={it.logo}
                    alt={it.label}
                    className={`h-3.5 w-3.5 shrink-0 rounded-sm ${it.invert ? 'dark:invert' : ''}`}
                  />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-muted" />
                )}
                <span className="leading-none">{it.label}</span>
              </div>
            ))}
          </div>
          {adminLabel ? (
            <div className="mt-2 border-t border-border/60 pt-1 text-muted-foreground">
              Admin: {adminLabel}
            </div>
          ) : null}

          {taskPath && diffSummary ? (
            <div className="mt-2 border-t border-border/60 pt-1">
              <div className="mb-1 font-medium text-foreground">Changes</div>
              {diffSummary.files > 0 ? (
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-2 text-foreground/90">
                    <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px]">
                      +{diffSummary.additions}
                    </span>
                    <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px]">
                      -{diffSummary.deletions}
                    </span>
                    <span className="text-muted-foreground">
                      · {diffSummary.files} file{diffSummary.files === 1 ? '' : 's'}
                    </span>
                  </div>
                  {diffSummary.top.map((t) => (
                    <div key={t.path} className="flex items-center justify-between gap-2">
                      <div className="truncate text-foreground/90" title={t.path}>
                        {t.path}
                      </div>
                      <div className="shrink-0 text-muted-foreground">
                        +{t.additions} / -{t.deletions}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No local changes</div>
              )}
            </div>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ProviderTooltip;
